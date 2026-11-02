/**
 * ChartGuard's language server (CG-06-04): chart config findings and verified edits for any editor
 * that speaks LSP. `serve` runs it on a stream pair; the `chartguard-language-server` bin on stdio.
 */
export { meta, serve, type ServeOptions } from './server.js';
