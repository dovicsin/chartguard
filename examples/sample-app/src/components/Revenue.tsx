import { Line } from 'react-chartjs-2';

import { baseOptions } from '../theme';

export function Revenue({ rows }: { rows: number[] }) {
	return (
		<Line data={{ labels: ['Jan', 'Feb'], datasets: [{ data: rows }] }} options={{ ...baseOptions, animation: true }} />
	);
}
