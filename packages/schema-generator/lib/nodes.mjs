/** IR helpers every generator module shares. */

/** `node`, or the definition it references. */
export const resolveIn = (definitions) => (node) => (node.kind === 'ref' ? definitions[node.ref] : node);

/** Two IR nodes are the same when they serialize the same (generated nodes keep a fixed key order). */
export const sameNode = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/** Code-point order: `localeCompare` depends on the machine's locale, generated output must not. */
export const compareText = (left, right) => (left < right ? -1 : Number(left > right));

/**
 * The error generation fails with when the upstream no longer has the shape a generator reads
 * (`upstreamChanged('echarts types')('no "series" property')`): an upstream change fails loudly, never
 * into a silently different artifact.
 */
export const upstreamChanged = (subject) => (what) => new Error(`${subject} changed: ${what}`);
