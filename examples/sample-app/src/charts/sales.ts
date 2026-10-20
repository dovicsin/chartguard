import { Chart } from 'chart.js';

import { baseOptions, palette } from '../theme';

export function salesConfig(type = 'bar') {
	const data = {
		labels: ['Q1', 'Q2', 'Q3'],
		datasets: [{ label: 'Sales', data: [3, 5, 4], backgroundColor: palette.primary }]
	};
	return { type, data, options: { ...baseOptions, scales: { y: { beginAtZerro: true } } } };
}

export function renderSales(canvas: HTMLCanvasElement) {
	return new Chart(canvas, salesConfig('line'));
}
