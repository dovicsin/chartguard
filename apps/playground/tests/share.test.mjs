import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';

import { deflateSync, Inflate } from 'fflate';

import { MAX_FRAGMENT_LENGTH, MAX_SHARED_BYTES, readShared, shareFragment } from '../dist/share.js';

/** Shared links (CG-06-06 part 2): the editor text in the fragment, read back bounded and as text only. */
const LIBRARIES = ['chartjs', 'echarts'];
const link = (library, bytes) =>
	new URLSearchParams({ library, config: Buffer.from(bytes).toString('base64url') }).toString();

test('a shared config reads back as the same text in the same library', () => {
	for (const text of ['', '{"type": "bar"}', '{\n\t"title": {"text": "Ünnep \u2028 😀"}\n}', ' not json at all ']) {
		const fragment = shareFragment('echarts', text);
		assert.equal(typeof fragment, 'string');
		assert.match(fragment, /^library=echarts&config=[A-Za-z0-9_-]+$/u);
		assert.deepEqual(readShared(fragment, LIBRARIES), { ok: true, library: 'echarts', text });
	}
});

test('a fragment without a config shares nothing: it is an example id', () => {
	assert.equal(readShared('echarts:contract:axis-type-typo', LIBRARIES), undefined);
	assert.equal(readShared('', LIBRARIES), undefined);
});

test('a malformed link is refused with its reason, never thrown', () => {
	const refused = (fragment) => {
		const shared = readShared(fragment, LIBRARIES);
		assert.equal(shared?.ok, false, fragment.slice(0, 60));
		return shared.reason;
	};
	assert.equal(refused(link('highcharts', deflateRawSync('{}'))), 'unknown library "highcharts"');
	assert.equal(refused('config=AAAA'), 'unknown library ""');
	assert.equal(refused('library=chartjs&config=a+b/'), 'the config is not base64url');
	assert.equal(refused('library=chartjs&config=abcde'), 'the config is not base64url');
	assert.equal(refused('library=chartjs&config=ab/c'), 'the config is not base64url');
	assert.equal(refused(link('chartjs', randomBytes(64).fill(0xff))), 'the config is not deflated data');
	assert.equal(refused('library=chartjs&config='), 'the config is not deflated data');
	assert.equal(refused(link('chartjs', deflateRawSync('{"a": 1}').subarray(0, 3))), 'the config is not deflated data');
	assert.equal(refused(link('chartjs', deflateRawSync(Buffer.from([0xc3, 0x28])))), 'the config is not UTF-8 text');
	assert.equal(
		refused(`library=chartjs&config=${'A'.repeat(MAX_FRAGMENT_LENGTH + 1)}`),
		`the link is longer than ${String(MAX_FRAGMENT_LENGTH)} characters`
	);
});

test('a small link that inflates beyond the bound is refused while inflating', () => {
	const bomb = deflateRawSync(Buffer.alloc(MAX_SHARED_BYTES + 1, 0x20));
	assert.ok(bomb.length < 2_000);
	// The largest bomb a link can carry: refused after inflating about the bound, never all of it.
	const huge = deflateRawSync(Buffer.alloc(70_000_000, 0x20), { level: 9 });
	assert.ok(Buffer.from(huge).toString('base64url').length <= MAX_FRAGMENT_LENGTH);
	const { push } = Inflate.prototype;
	let consumed = 0;
	Inflate.prototype.push = function counted(chunk, final) {
		consumed += chunk.byteLength;
		return push.call(this, chunk, final);
	};
	try {
		assert.equal(readShared(link('chartjs', huge), LIBRARIES).ok, false);
	} finally {
		Inflate.prototype.push = push;
	}
	assert.ok(consumed < 4_000, `${String(consumed)} of ${String(huge.byteLength)} deflated bytes inflated`);
	const shared = readShared(link('chartjs', bomb), LIBRARIES);
	assert.deepEqual(shared, { ok: false, reason: `the config is larger than ${String(MAX_SHARED_BYTES)} bytes` });
	const fits = readShared(link('chartjs', deflateRawSync(Buffer.alloc(MAX_SHARED_BYTES, 0x20))), LIBRARIES);
	assert.equal(fits.ok && fits.text.length, MAX_SHARED_BYTES);
});

test('no link is made that a reader would refuse: too large a text, too long a link', () => {
	assert.deepEqual(shareFragment('chartjs', ' '.repeat(MAX_SHARED_BYTES + 1)), {
		reason: `the config is larger than ${String(MAX_SHARED_BYTES)} bytes`
	});
	assert.equal(typeof shareFragment('chartjs', ' '.repeat(MAX_SHARED_BYTES)), 'string');
	// Random text barely compresses: 90 kB of it cannot fit in 100 000 characters of base64.
	const noise = randomBytes(90_000).toString('latin1');
	assert.deepEqual(shareFragment('chartjs', noise), {
		reason: `the link would be longer than ${String(MAX_FRAGMENT_LENGTH)} characters`
	});
});

test('at the bound: the longest link is made, one that would be longer is not', () => {
	// Deterministic noise: hex digits of SHA-256 hashes, which deflate cannot shrink below about half.
	const digits = Array.from({ length: 5_000 }, (_, index) =>
		createHash('sha256').update(String(index)).digest('hex')
	).join('');
	const encodedLength = (length) =>
		Buffer.from(deflateSync(new TextEncoder().encode(digits.slice(0, length)), { level: 9 })).toString('base64url')
			.length;
	let [low, high] = [0, digits.length];
	while (high - low > 1) {
		const middle = Math.floor((low + high) / 2);
		if (encodedLength(middle) <= MAX_FRAGMENT_LENGTH) low = middle;
		else high = middle;
	}
	assert.ok(encodedLength(high) > MAX_FRAGMENT_LENGTH && encodedLength(high) < MAX_FRAGMENT_LENGTH + 100);
	assert.equal(typeof shareFragment('chartjs', digits.slice(0, low)), 'string');
	assert.equal(typeof shareFragment('chartjs', digits.slice(0, high)), 'object');
	const fitting = shareFragment('chartjs', randomBytes(30_000).toString('hex'));
	assert.equal(typeof fitting, 'string');
	assert.ok(fitting.length <= MAX_FRAGMENT_LENGTH + 'library=chartjs&config='.length);
});
