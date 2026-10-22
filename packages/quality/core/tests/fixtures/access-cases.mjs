import { ecBars, hcBars } from './charts.mjs';

/** The rules contract's accessibility cases (CG-05-04 part 5); they set their own accessibility options. */
const TITLE = { text: 'Quarterly sales' };

export const ACCESS_CASES = [
	{
		name: 'echarts without aria describes nothing to assistive technology',
		rule: 'data-not-described',
		kind: 'triggers',
		access: true,
		echarts: {
			config: { ...ecBars([1, 2], { name: 'Units' }), title: TITLE },
			findings: ['VIS_DATA_NOT_DESCRIBED $.aria.enabled']
		}
	},
	{
		name: 'aria enabled but its description turned off',
		rule: 'data-not-described',
		kind: 'triggers',
		access: true,
		echarts: {
			config: {
				...ecBars([1, 2], { name: 'Units' }),
				title: TITLE,
				aria: { enabled: true, label: { enabled: false } }
			},
			findings: ['VIS_DATA_NOT_DESCRIBED $.aria.label.enabled']
		}
	},
	{
		name: 'counterexample: aria enabled describes the data',
		rule: 'data-not-described',
		kind: 'counterexample',
		access: true,
		echarts: { config: { ...ecBars([1, 2], { name: 'Units' }), title: TITLE, aria: { enabled: true } }, findings: [] }
	},
	{
		name: 'Highcharts accessibility turned off: no point labels and no keyboard access',
		rule: 'data-not-described',
		kind: 'triggers',
		access: true,
		highcharts: {
			config: { ...hcBars([1, 2], { title: { text: 'Units' } }), title: TITLE, accessibility: { enabled: false } },
			findings: ['VIS_DATA_NOT_DESCRIBED $.accessibility.enabled', 'VIS_KEYBOARD_DISABLED $.accessibility.enabled']
		}
	},
	{
		name: 'Highcharts keyboard navigation turned off',
		rule: 'keyboard-disabled',
		kind: 'triggers',
		access: true,
		highcharts: {
			config: {
				...hcBars([1, 2], { title: { text: 'Units' } }),
				title: TITLE,
				accessibility: { keyboardNavigation: { enabled: false } }
			},
			findings: ['VIS_KEYBOARD_DISABLED $.accessibility.keyboardNavigation.enabled']
		}
	}
];
