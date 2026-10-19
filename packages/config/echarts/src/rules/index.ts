import type { ConfigRule } from '@chartguard/config-core';

import { cartesianAxes } from './cartesian.js';
import { heatmapVisualMap } from './heatmap.js';
import { heatmapCategoryAxes } from './heatmap-axes.js';
import { legendNames } from './legend.js';

/** Rules over several options at once, each mirroring a check of the echarts 6.1.0 runtime (CG-02-08). */
export const RULES: readonly ConfigRule[] = [heatmapVisualMap, heatmapCategoryAxes, cartesianAxes, legendNames];
