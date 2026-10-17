import { POLICY } from './boundaries/policy.mjs';
import { checkWorkspace } from './boundaries/workspace.mjs';

const violations = checkWorkspace(process.cwd(), POLICY);

for (const { packageName, file, line, message } of violations)
	console.error(`${packageName} ${file}:${line}: ${message}`);

if (violations.length > 0) process.exit(1);
console.log('Package boundaries respected.');
