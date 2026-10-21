import { validate } from '@chartguard/config-echarts';
import { createValidateBeforeCreate } from '@chartguard/core';

/** Never monkey-patches global APIs. Caller owns the original factory and side effects. */
export const validateBeforeCreate = createValidateBeforeCreate('echarts', validate);

export { type EChartsRuntime, registriesOf } from './registries.js';
export type { EChartsInstance, SetOptionGuard, SetOptionSettings } from './set-option.js';
export { checkOption, setOption } from './set-option.js';
