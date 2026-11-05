import { fileURLToPath } from 'node:url';

/** The parts of LSP's messages the server reads (CG-06-04 part 2); everything else in them is ignored. */

/** JSON-RPC and LSP error codes the server answers with. */
export const ERRORS = {
	parse: -32700,
	invalidRequest: -32600,
	methodNotFound: -32601,
	internal: -32603,
	notInitialized: -32002
} as const;

export interface Message {
	readonly id?: number | string | null;
	readonly method?: string;
	readonly params?: Record<string, unknown>;
}

export interface InitializeParams {
	readonly rootUri?: string | null;
	readonly workspaceFolders?: readonly { readonly uri: string }[] | null;
	readonly capabilities?: {
		readonly textDocument?: { readonly publishDiagnostics?: { readonly codeDescriptionSupport?: boolean } };
		readonly workspace?: {
			readonly workspaceEdit?: { readonly documentChanges?: boolean; readonly changeAnnotationSupport?: object };
		};
	};
	readonly initializationOptions?: { readonly settings?: Record<string, unknown> };
}

export interface NotificationParams {
	readonly textDocument?: { uri: string; languageId?: string; version?: number; text?: string };
	/** Read in shape where applied (`changedText`): a client's message is checked, never trusted. */
	readonly contentChanges?: unknown;
	readonly settings?: Record<string, unknown>;
}

/** The path a URI names when it is a file URI, decided by parsing it (never by its text). */
export function pathOf(uri: string): string | undefined {
	try {
		return fileURLToPath(uri);
	} catch {
		return undefined;
	}
}

/** The workspace's directory: its first folder, else its root, when either is a file URI. */
export function rootOf({ workspaceFolders, rootUri }: InitializeParams): string | undefined {
	const folder = workspaceFolders?.[0]?.uri ?? rootUri;
	return typeof folder === 'string' ? pathOf(folder) : undefined;
}

/** Whether the client can ask the user to confirm an edit (change annotations in document changes). */
export function annotationsOf({ capabilities }: InitializeParams): boolean {
	const edits = capabilities?.workspace?.workspaceEdit;
	return edits?.documentChanges === true && edits.changeAnnotationSupport !== undefined;
}

/** Whether the client links a diagnostic's code to its `codeDescription` (LSP 3.16). */
export function linksOf({ capabilities }: InitializeParams): boolean {
	return capabilities?.textDocument?.publishDiagnostics?.codeDescriptionSupport === true;
}

export const isMessage = (value: unknown): value is Message =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
