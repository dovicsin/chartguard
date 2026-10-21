import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createValidator } from '@chartguard/config-highcharts';

import { MODULE_CONTRACT } from '../../../packages/config/highcharts/tests/fixtures/module-contract.mjs';
import { registriesOf } from '../../../packages/integrations/highcharts-runtime/dist/index.js';
import { browserSkipReason } from '../../shared/chrome.mjs';
import { verdictOf } from '../lib/capture.mjs';
import { runHighcharts } from '../lib/highcharts.mjs';

/** Generated from the installed highcharts by `npm run build`; never committed (CG-01-05). */
const LOCAL = fileURLToPath(new URL('../../../node_modules/.cache/chartguard/highcharts-13.1.1.json', import.meta.url));
const validate = createValidator(JSON.parse(readFileSync(LOCAL, 'utf8')));

const browser = { skip: browserSkipReason() ?? false };
const outcomes = browser.skip === false ? await runHighcharts(MODULE_CONTRACT) : [];

MODULE_CONTRACT.forEach((entry, index) =>
	test(`highcharts modules: ${entry.name}`, browser, () => {
		const { seriesTypes, threw, messages } = outcomes[index];
		assert.equal(verdictOf(outcomes[index]), entry.runtime, JSON.stringify({ threw, messages }));
		// The registry context as runtime-highcharts reads it from that page's Highcharts.
		const registries = registriesOf({ seriesTypes: Object.fromEntries(seriesTypes.map((name) => [name, {}])) });
		const result = validate(entry.config, { libraryVersion: '13.1.1', registries });
		assert.deepEqual(
			result.diagnostics.map((d) => `${d.severity} ${d.code} ${d.path}`),
			entry.findings
		);
	})
);
