#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { main } from '../dist/index.js';

export { main };

// npm links bins through symlinks, so compare resolved paths.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && realpathSync(invokedPath) === fileURLToPath(import.meta.url))
	process.exitCode = await main();
