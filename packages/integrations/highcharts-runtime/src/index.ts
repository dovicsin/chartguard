import { validate } from '@chartguard/config-highcharts';
import { createValidateBeforeCreate } from '@chartguard/core';

/** Never monkey-patches global APIs. Caller owns the original factory and side effects. */
export const validateBeforeCreate = createValidateBeforeCreate('highcharts', validate);
