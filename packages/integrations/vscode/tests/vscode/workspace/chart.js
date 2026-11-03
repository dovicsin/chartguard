import { Chart } from 'chart.js';
import * as echarts from 'echarts';

new Chart(canvas, { type: 'bar', data: { datasets: [] }, options: { scales: { y: { min: 'x' } } } });
echarts.init(element).setOption({ series: [{ type: 'pie', clockWise: false, data: [1] }] });
