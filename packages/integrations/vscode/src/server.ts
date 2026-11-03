import { serve } from '@chartguard/language-server';

/**
 * The language server as the extension runs it, in its own process: LSP over stdio (the client also
 * passes `--stdio`); stdout carries only protocol messages. Bundled with everything it needs.
 */
serve({
	input: process.stdin,
	output: process.stdout,
	onExit: (code) => {
		process.exit(code);
	}
});
