/** Chart builders shared by the rules contract's cases (CG-05-04). */
export const LABELS = ['Q1', 'Q2'];
export const cjBars = (data, scale, extra = {}) => ({
	type: 'bar',
	data: { labels: LABELS, datasets: [{ label: 'Sales', data }] },
	options: { scales: { y: scale }, ...extra }
});
export const ecBars = (data, yAxis) => ({
	xAxis: { type: 'category', data: LABELS },
	yAxis,
	series: [{ type: 'bar', data }]
});
export const hcBars = (data, yAxis) => ({
	chart: { type: 'column' },
	xAxis: { categories: LABELS },
	yAxis,
	series: [{ data }]
});
