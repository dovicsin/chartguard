import assert from 'node:assert/strict';
import test from 'node:test';

import { isNewer, releaseIssues } from '../upstream-releases.mjs';

test('a release is newer by major, minor and patch, as numbers; anything not MAJOR.MINOR.PATCH is not (E97)', () => {
	assert.equal(isNewer('4.6.1', '4.5.1'), true);
	assert.equal(isNewer('4.10.0', '4.9.9'), true);
	assert.equal(isNewer('5.0.0', '4.99.99'), true);
	assert.equal(isNewer('4.5.1', '4.5.1'), false);
	assert.equal(isNewer('4.5.0', '4.5.1'), false);
	assert.equal(isNewer('4.6.0-beta.1', '4.5.1'), false);
	assert.equal(isNewer('latest', '4.5.1'), false);
});

test('one issue for each pin npm has a newer release of, none for a current or unknown one (E97)', () => {
	const pins = [
		{ package: 'chart.js', version: '4.5.1' },
		{ package: 'echarts', version: '6.1.0' },
		{ package: 'highcharts', version: '13.1.1' }
	];
	const latest = { 'chart.js': '4.6.1', echarts: '6.1.0' };
	const issues = releaseIssues(pins, (name) => latest[name]);
	assert.deepEqual(
		issues.map(({ title }) => title),
		['Upstream release: chart.js 4.6.1']
	);
	assert.match(issues[0]?.body ?? '', /pinned to 4\.5\.1/u);
	assert.doesNotMatch(issues[0]?.body ?? '', /[\t\n]/u, 'one line, read as the second tab-separated field');
});
