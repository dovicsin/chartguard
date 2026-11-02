#!/usr/bin/env node
import { serve } from '../dist/index.js';

// LSP over stdio (editors also pass `--stdio`): stdout carries only protocol messages. This file is
// only ever run, never imported, so it serves unconditionally.
serve({
	input: process.stdin,
	output: process.stdout,
	onExit: (code) => {
		process.exit(code);
	}
});
