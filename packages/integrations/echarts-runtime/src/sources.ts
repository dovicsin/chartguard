/**
 * The ECharts behaviour the wrapper rests on, each a pointer into the pinned echarts checked by a test
 * (E37): a series whose type has no registered model is dropped ("Unknown series", `dropped` in
 * set-option.ts); a merge maps items to the held series by position (`mappingByIndex`): an item that is
 * not an object is set to `null` and takes none, and an internal series is skipped (`slots`); a fresh
 * option (`replaceAll`) or a `replaceMerge` of `series` merges no item into a held series (`isFresh`).
 */
export const SOURCES = [
	'echarts@6.1.0 lib/model/Global.js:303 error("Unknown series " + subType);',
	"echarts@6.1.0 lib/model/Global.js:261 !oldCmptList ? 'replaceAll' : replaceMergeMainTypeMap && replaceMergeMainTypeMap.get(mainType) ? 'replaceMerge' : 'normalMerge';",
	'echarts@6.1.0 lib/util/model.js:156 if (!isObject(cmptOption)) {',
	'echarts@6.1.0 lib/util/model.js:270 // In mode "replaceMerge", here no not-mapped-non-internal-existing.',
	'echarts@6.1.0 lib/util/model.js:252 function mappingByIndex(result, newCmptOptions, brandNew) {',
	'echarts@6.1.0 lib/util/model.js:269 ) && (resultItem.newOption || isComponentIdInternal(resultItem.existing) ||',
	'echarts@6.1.0 lib/util/model.js:402 return cmptOption && cmptOption.id != null && makeComparableKey(cmptOption.id).indexOf(INTERNAL_COMPONENT_ID_PREFIX) === 0;'
] as const;
