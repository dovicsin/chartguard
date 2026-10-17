import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

// Project references in tsconfig.json define the build order.
const { status } = spawnSync(process.execPath, [tsc, '-b', 'tsconfig.json'], { stdio: 'inherit' });

if (status !== 0) process.exit(status ?? 1);
console.log('Build successful; CLI is native ESM.');
