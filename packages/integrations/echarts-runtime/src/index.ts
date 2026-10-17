import { validate } from '@chartguard/config-echarts';
import { createValidateBeforeCreate } from '@chartguard/core';

/** Never monkey-patches global APIs. Caller owns the original factory and side effects. */
export const validateBeforeCreate = createValidateBeforeCreate('echarts', validate);
