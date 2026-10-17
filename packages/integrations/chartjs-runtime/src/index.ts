import { validate } from '@chartguard/config-chartjs';
import { createValidateBeforeCreate } from '@chartguard/core';

/** Never monkey-patches global APIs. Caller owns the original factory and side effects. */
export const validateBeforeCreate = createValidateBeforeCreate('chartjs', validate);
