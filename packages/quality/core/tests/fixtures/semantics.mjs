/** Hand-built chart semantics for core rule tests: every fact unknown unless a test sets it. */
export const fact = (value, path, source = 'config') => ({
	known: true,
	value,
	path,
	source,
	...(source === 'default' ? { pointer: 'p' } : {})
});
export const none = (path, reason = 'unset') => ({ known: false, path, reason });
export const series = (kind, valueAxis, orientation = fact('vertical', '$.o')) => ({
	path: '$.s',
	type: fact(kind, '$.t'),
	kind: fact(kind, '$.t'),
	name: none('$.n'),
	stacking: none('$.stack'),
	base: none('$.base'),
	valueAxis,
	orientation,
	color: none('$.color')
});
export const axis = (key, min, extra = {}) => ({
	key,
	path: `$.${key}`,
	scale: none('$.scale'),
	min,
	max: none('$.max'),
	fit: none('$.fit'),
	unit: none('$.unit'),
	panel: fact('plot', '$.panel', 'default'),
	reversed: none('$.reversed'),
	title: { text: none('$.title'), shown: none('$.shown') },
	...extra
});
export const chart = ({ items = [], axes = [], text = none('$.title.text'), shown = none('$.title.show') } = {}) => ({
	library: 't',
	title: { text, shown },
	series: { known: true, path: '$.series', items },
	axes,
	background: none('$.background'),
	motion: { endless: none('$.endless'), longest: none('$.longest') },
	access: { dataDescribed: none('$.access'), keyboard: none('$.keyboard') }
});
