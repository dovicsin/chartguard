import { SettingsError, SourceChecker, type SourceFinding } from '@chartguard/source-checks';

import { actionsOf, changedText, diagnosticOf, fileNameOf, isChecked, type OpenDocument } from './documents.js';
import { framed, FramingError, MessageReader } from './framing.js';
import { Lines, type Range } from './positions.js';
import {
	annotationsOf,
	ERRORS,
	type InitializeParams,
	isMessage,
	type NotificationParams,
	rootOf
} from './protocol.js';

export const meta = { name: 'chartguard-language-server', version: '0.1.0' };

/** Where the editor's settings are read: every problem in them is named so. */
const PREFIX = 'chartguard';

export interface ServeOptions {
	readonly input: NodeJS.ReadableStream;
	readonly output: NodeJS.WritableStream;
	/** How long a document rests after a change before it is checked again, in milliseconds. */
	readonly delay?: number;
	/** Called once the connection ends: 0 after `shutdown` then `exit`, 1 otherwise. */
	readonly onExit?: (code: number) => void;
}

/**
 * A language server over a stream pair (CG-06-04 part 2): open documents are checked as they change
 * (incremental text sync), each finding published as a diagnostic at LSP positions, with the engine's
 * verified edits as code actions. Nothing a document holds is ever run.
 */
class Server {
	private readonly documents = new Map<string, OpenDocument>();
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly reader = new MessageReader();
	private checker: SourceChecker | undefined;
	private root = process.cwd();
	private annotations = false;
	private state: 'new' | 'running' | 'shut down' | 'ended' = 'new';
	/** The last setup problem said, so a problem every check meets is said once. */
	private said: string | undefined;

	constructor(private readonly options: ServeOptions) {
		this.checker = this.checkerFor(undefined);
		options.input.on('data', (chunk: Buffer) => {
			this.receive(chunk);
		});
	}

	private receive(chunk: Buffer): void {
		if (this.state === 'ended') return;
		let bodies: string[];
		try {
			bodies = this.reader.push(chunk);
		} catch (error) {
			if (!(error instanceof FramingError)) throw error;
			this.log(1, `ChartGuard: the connection is closed: ${error.message}.`);
			this.end(1);
			return;
		}
		for (const body of bodies) this.handle(body);
	}

	private handle(body: string): void {
		let message: unknown;
		try {
			message = JSON.parse(body);
		} catch {
			this.send({ jsonrpc: '2.0', id: null, error: { code: ERRORS.parse, message: 'Parse error' } });
			return;
		}
		if (!isMessage(message) || typeof message.method !== 'string') {
			if (isMessage(message) && message.id !== undefined && message.method === undefined) return;
			this.send({ jsonrpc: '2.0', id: null, error: { code: ERRORS.invalidRequest, message: 'Invalid request' } });
			return;
		}
		if (message.id === undefined) this.notification(message.method, message.params ?? {});
		else this.request(message.id, message.method, message.params ?? {});
	}

	private request(id: number | string | null, method: string, params: Record<string, unknown>): void {
		const fail = (code: number, message: string): void => {
			this.send({ jsonrpc: '2.0', id, error: { code, message } });
		};
		if (this.state === 'new' && method !== 'initialize') {
			fail(ERRORS.notInitialized, 'Server not initialized');
			return;
		}
		if (this.state === 'shut down') {
			fail(ERRORS.invalidRequest, 'Server is shut down');
			return;
		}
		try {
			const result = this.answer(method, params);
			if (result === undefined) fail(ERRORS.methodNotFound, `Unhandled method ${method}`);
			else this.send({ jsonrpc: '2.0', id, result: result.value });
		} catch (error) {
			fail(ERRORS.internal, error instanceof Error ? error.message : String(error));
		}
	}

	/** The result of a request the server handles, or undefined for a method it does not. */
	private answer(method: string, params: Record<string, unknown>): { value: unknown } | undefined {
		if (method === 'initialize') return { value: this.initialize(params) };
		if (method === 'shutdown') {
			this.state = 'shut down';
			return { value: null };
		}
		if (method === 'textDocument/codeAction') return { value: this.codeActions(params) };
		return undefined;
	}

	private initialize(params: InitializeParams): object {
		this.root = rootOf(params) ?? this.root;
		this.annotations = annotationsOf(params);
		this.checker = this.checkerFor(params.initializationOptions?.settings?.[PREFIX]);
		this.state = 'running';
		return {
			capabilities: {
				textDocumentSync: { openClose: true, change: 2 },
				codeActionProvider: { codeActionKinds: ['quickfix'] }
			},
			serverInfo: { name: meta.name, version: meta.version }
		};
	}

	/** The notifications the server acts on while running; any other is ignored, as LSP allows. */
	private readonly handlers: Readonly<Record<string, (params: NotificationParams) => void>> = {
		'textDocument/didOpen': ({ textDocument }) => {
			if (textDocument !== undefined) this.opened(textDocument);
		},
		'textDocument/didChange': ({ textDocument, contentChanges }) => {
			if (textDocument !== undefined) this.changed(textDocument, contentChanges);
		},
		'textDocument/didClose': ({ textDocument }) => {
			if (textDocument !== undefined) this.closed(textDocument.uri);
		},
		'workspace/didChangeConfiguration': ({ settings }) => {
			this.configured(settings?.[PREFIX]);
		}
	};

	private notification(method: string, params: Record<string, unknown>): void {
		if (method === 'exit') {
			this.end(this.state === 'shut down' ? 0 : 1);
			return;
		}
		if (this.state !== 'running' || !Object.hasOwn(this.handlers, method)) return;
		// A notification has no reply to carry an error: a malformed one is logged, and the server serves on.
		try {
			this.handlers[method]?.(params);
		} catch (error) {
			this.log(1, `ChartGuard could not handle ${method}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private opened({
		uri,
		languageId = '',
		version = 0,
		text = ''
	}: {
		uri: string;
		languageId?: string;
		version?: number;
		text?: string;
	}): void {
		this.documents.set(uri, { uri, languageId, version, text, lines: new Lines(text), findings: [] });
		this.schedule(uri);
	}

	private changed(textDocument: { uri: string; version?: number }, changes: unknown): void {
		const known = this.documents.get(textDocument.uri);
		if (known === undefined || (Array.isArray(changes) && changes.length === 0)) return;
		const changed = changedText(known.text, known.lines, changes);
		if (changed === undefined) {
			// The editor's text is no longer known: what was found in it is withdrawn, nothing is claimed.
			this.closed(known.uri);
			throw new Error('a content change that cannot be applied; the document is checked again once reopened');
		}
		const version = textDocument.version ?? known.version;
		this.documents.set(known.uri, { ...known, version, ...changed });
		this.schedule(known.uri);
	}

	private closed(uri: string): void {
		// A check still scheduled finds no document and publishes nothing.
		this.documents.delete(uri);
		this.notify('textDocument/publishDiagnostics', { uri, diagnostics: [] });
	}

	private configured(settings: unknown): void {
		this.checker = this.checkerFor(settings);
		for (const uri of this.documents.keys()) this.schedule(uri);
	}

	/** A checker for the editor's settings, or none while they cannot be used (said once). */
	private checkerFor(settings: unknown): SourceChecker | undefined {
		try {
			this.said = undefined;
			return new SourceChecker(settings, PREFIX);
		} catch (error) {
			if (!(error instanceof SettingsError)) throw error;
			this.say(error.message);
			return undefined;
		}
	}

	private schedule(uri: string): void {
		clearTimeout(this.timers.get(uri));
		this.timers.set(
			uri,
			setTimeout(() => {
				this.timers.delete(uri);
				this.publish(uri);
			}, this.options.delay ?? 200)
		);
	}

	private publish(uri: string): void {
		const document = this.documents.get(uri);
		if (document === undefined || this.state !== 'running') return;
		const checked = { ...document, findings: this.findingsOf(document) };
		this.documents.set(uri, checked);
		const diagnostics = checked.findings.map((finding) => diagnosticOf(checked, finding));
		this.notify('textDocument/publishDiagnostics', { uri, version: document.version, diagnostics });
	}

	/** The findings of a document; a setup problem is said once and claims nothing, a defect is logged. */
	private findingsOf({ uri, languageId, text }: OpenDocument): readonly SourceFinding[] {
		if (this.checker === undefined || !isChecked(languageId)) return [];
		try {
			return this.checker.check(text, fileNameOf(uri, languageId, this.root), this.root);
		} catch (error) {
			if (error instanceof SettingsError) this.say(error.message);
			else
				this.log(
					1,
					`ChartGuard could not check ${uri}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
				);
			return [];
		}
	}

	private codeActions(params: Record<string, unknown>): object[] {
		const { textDocument, range } = params as { textDocument?: { uri: string }; range?: Range };
		const document = textDocument === undefined ? undefined : this.documents.get(textDocument.uri);
		return document === undefined || range === undefined ? [] : actionsOf(document, range, this.annotations);
	}

	private say(message: string): void {
		if (this.said === message) return;
		this.said = message;
		this.notify('window/showMessage', { type: 1, message });
	}

	private log(type: number, message: string): void {
		this.notify('window/logMessage', { type, message });
	}

	private notify(method: string, params: object): void {
		this.send({ jsonrpc: '2.0', method, params });
	}

	private send(message: object): void {
		this.options.output.write(framed(message));
	}

	private end(code: number): void {
		this.state = 'ended';
		for (const timer of this.timers.values()) clearTimeout(timer);
		this.timers.clear();
		this.options.onExit?.(code);
	}
}

/** Serves the language server protocol on `input` and `output` until the client says `exit`. */
export function serve(options: ServeOptions): void {
	new Server(options);
}
