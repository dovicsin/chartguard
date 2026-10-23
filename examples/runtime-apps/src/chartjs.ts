import { guard } from '@chartguard/runtime-chartjs';
import { CategoryScale, Chart, LinearScale, LineController, LineElement, PointElement } from 'chart.js';

import { box, runApp, type Seen, seen } from './report.js';

// A tree-shaken Chart.js: only what a line chart needs is registered.
Chart.register(LineController, LineElement, PointElement, CategoryScale, LinearScale);

runApp(() => {
	const results: Seen[] = [];
	const options = {
		block: true,
		onResult: (result: Parameters<typeof seen>[1], { phase, mode }: { phase: string; mode?: string }) =>
			results.push(seen(mode === undefined ? phase : `${phase} ${mode}`, result))
	};

	const sales = new Chart(
		box('canvas') as HTMLCanvasElement,
		guard({ type: 'line', data: { labels: ['Q1', 'Q2'], datasets: [{ label: 'Sales', data: [3, 5] }] } }, options)
	);
	// A wrong update is checked before Chart.js draws it, and not drawn.
	(sales.data.datasets[0] as { borderWidth?: unknown }).borderWidth = 'wide';
	sales.update();
	sales.destroy();

	// A bar chart on a runtime without BarController: Chart.js would throw; the guard blocks it first.
	let threw = false;
	try {
		new Chart(
			box('canvas') as HTMLCanvasElement,
			guard({ type: 'bar', data: { labels: ['a'], datasets: [{ label: 'a', data: [1] }] } }, options)
		).destroy();
	} catch {
		threw = true;
	}
	// An invalid scale: Chart.js renders once on attach, once more on creation, and again at an update;
	// with block none of them is drawn while the scales are those the chart was created with (A46).
	let scaleDraws = 0;
	const counter = { id: 'draws', afterDraw: () => void (scaleDraws += 1) };
	const cut = new Chart(
		box('canvas') as HTMLCanvasElement,
		guard(
			{
				type: 'line',
				data: { labels: ['Q1', 'Q2'], datasets: [{ label: 'Sales', data: [3, 5] }] },
				// A minimum read from an untyped source (a form field): a string where Chart.js wants a number.
				options: { scales: { y: { type: 'linear', min: '50' as unknown as number } } },
				plugins: [counter]
			},
			options
		)
	);
	cut.update();
	cut.destroy();
	return { library: 'chartjs', results, threw, scaleDraws, instances: Object.keys(Chart.instances).length };
});
