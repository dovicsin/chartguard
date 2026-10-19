import { observe } from './capture.mjs';
import { copyPlain } from './copy.mjs';

/**
 * Renders an option with an echarts API (the full bundle, or `echarts/core` after `use`) in
 * server-side mode (SVG string, no DOM). Imports no echarts module itself, so it never registers anything.
 */
export function renderWith(echarts, option) {
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
