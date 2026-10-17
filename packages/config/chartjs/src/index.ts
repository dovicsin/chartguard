import { s, type SchemaManifest, validateConfig } from '@chartguard/config-core';
import type { ValidationResult } from '@chartguard/core';

const CHART_TYPES = ['bar', 'line', 'pie', 'doughnut', 'scatter', 'radar', 'polarArea', 'bubble'];

const scale = s.object({
	beginAtZero: s.boolean(),
	min: s.number(),
	max: s.number(),
	display: s.boolean(),
	title: s.object({ display: s.boolean(), text: s.string() })
});

const dataset = s.object({
	label: s.string(),
	data: s.array(s.any()),
	backgroundColor: s.any(),
	borderColor: s.any(),
	type: s.string(),
	yAxisID: s.string(),
	xAxisID: s.string()
});

const options = s.object({
	responsive: s.boolean(),
	maintainAspectRatio: s.boolean(),
	indexAxis: s.string(['x', 'y']),
	scales: s.object({ x: scale, y: scale }),
	plugins: s.object({
		legend: s.object({ display: s.boolean(), position: s.string() }),
		tooltip: s.object({ enabled: s.boolean() })
	})
});

export const manifest: SchemaManifest = {
	library: 'chartjs',
	version: '4.x (starter subset)',
	coverage: 'partial',
	source: 'manually curated from public config model; verify against exact target version',
	root: s.object(
		{
			type: s.string(CHART_TYPES),
			data: s.object({ labels: s.array(s.any()), datasets: s.array(dataset) }),
			options
		},
		'warn',
		['type', 'data']
	)
};

export function validate(input: unknown): ValidationResult {
	return validateConfig(input, manifest);
}
