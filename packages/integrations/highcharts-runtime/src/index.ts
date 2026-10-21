import { validate } from '@chartguard/config-highcharts';
import { createValidateBeforeCreate } from '@chartguard/core';

export { type ChartFactory, createChart, type Created, type CreateGuard, type HighchartsNamespace } from './create.js';
export { type HighchartsRuntime, registriesOf } from './registries.js';
export type { ChartEvent, ChartGuard } from './report.js';
export type { HighchartsChart, HighchartsSeries } from './series.js';
export { type Added, addSeries, type AddSeriesSettings, checkUpdate, update, type UpdateSettings } from './update.js';

/** Never monkey-patches global APIs. Caller owns the original factory and side effects. */
export const validateBeforeCreate = createValidateBeforeCreate('highcharts', validate);
