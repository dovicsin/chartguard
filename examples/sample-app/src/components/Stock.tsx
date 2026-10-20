import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';

const options = {
	title: { text: 'Stock' },
	series: [{ type: 'line', data: [1, 2, 3] }]
};

export const Stock = () => <HighchartsReact highcharts={Highcharts} options={options} />;
