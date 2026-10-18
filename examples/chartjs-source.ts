const base = { responsive: true };
const config = {
	type: 'bar',
	data: { labels: ['A', 'B'], datasets: [{ data: [1, 2] }] },
	options: { ...base, scales: { y: { type: 'linear', beginAtZerro: true } } }
};
