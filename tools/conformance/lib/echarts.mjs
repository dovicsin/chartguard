import * as echarts from 'echarts';

import { observe } from './capture.mjs';
import { copyPlain } from './copy.mjs';

/**
 * Renders an option with the pinned echarts runtime in server-side mode (SVG string, no DOM).
 * The full bundle registers every built-in component and series, matching the generated schema.
 */
export function runEcharts(option) {
	return observe(() => {
		const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 300 });
		try {
			chart.setOption(copyPlain(option));
			chart.renderToSVGString();
		} finally {
			chart.dispose();
		}
	});
}
