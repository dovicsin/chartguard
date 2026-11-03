/**
 * What each `CFG_*` code means and what to do about it (CG-06-07): the text of the reference's codes
 * page. Which packages emit a code is read from their sources at build time, and a test keeps this
 * catalog to exactly the codes they emit. The quality codes (`VIS_*`) are documented by their rules'
 * own catalog, `RULE_CATALOG`.
 */

/** @typedef {{ code: string; group: string; title: string; meaning: string; action: string }} CodeEntry */

/** The groups the page lists codes in, in order. */
export const GROUPS = [
	{ id: 'options', title: 'Options the runtime rejects or misreads' },
	{ id: 'runtime', title: 'What the runtime has registered or ignores' },
	{ id: 'partial', title: 'What could not be checked' },
	{ id: 'version', title: 'Versions and settings' },
	{ id: 'source', title: 'Reading source code' }
];

/** @type {readonly CodeEntry[]} */
export const CODES = [
	{
		code: 'CFG_TYPE',
		group: 'options',
		title: 'A value of the wrong kind',
		meaning:
			'The option holds a kind of value the runtime does not read there: a string where it reads a number, an object where it reads a list. The message names what is expected. An error when the schema fact comes from the library’s own declarations; a warning when it rests on a derived or hand-written one.',
		action:
			'Give the option a value of the expected kind. A value built at runtime (a callback) is accepted where the library accepts one.'
	},
	{
		code: 'CFG_ENUM',
		group: 'options',
		title: 'A value outside the allowed set',
		meaning:
			'The option only takes a fixed set of values (a type name, a position) and this one is not among them; the message lists the allowed values and, for a near miss, suggests one.',
		action:
			'Use one of the listed values. If the value comes from a plugin, describe the plugin with `withExtensions` so it is known.'
	},
	{
		code: 'CFG_UNKNOWN_KEY',
		group: 'options',
		title: 'A property the schema does not know',
		meaning:
			'The object has a property its schema does not declare, often a typo (the suggestion names the closest known one). An error only where the schema is complete and closed there; elsewhere a warning, since a partial schema may not know every valid option.',
		action: 'Fix the name, remove the property, or describe the plugin that reads it with `withExtensions`.'
	},
	{
		code: 'CFG_REQUIRED',
		group: 'options',
		title: 'A required property is missing',
		meaning:
			'The runtime needs this property and has no default for it: without it, it throws or draws nothing (ECharts drops a series without a type and nothing to merge into). Not claimed for a config the analysis read only in part.',
		action: 'Add the property.'
	},
	{
		code: 'CFG_DEPRECATED',
		group: 'options',
		title: 'A deprecated option',
		meaning:
			'The runtime still reads the option but has replaced it; the message says since when and by what. Where the runtime itself reads the old name as the new one, the finding carries a `rename-key` fix that changes nothing else, which tools may apply.',
		action: 'Use the replacement the message names, or apply the rename fix.'
	},
	{
		code: 'CFG_REQUIRES',
		group: 'options',
		title: 'An option that needs another',
		meaning:
			'A check over several options, mirroring one the runtime makes: this option only works with another one present (an ECharts heatmap needs a `visualMap`, a series on a cartesian grid needs the axis it names). Without it the runtime throws or draws nothing.',
		action: 'Add the option the message names, or change the reference to one that exists.'
	},
	{
		code: 'CFG_UNKNOWN_REFERENCE',
		group: 'options',
		title: 'A name that refers to nothing',
		meaning:
			'The option names another part of the chart by name (an ECharts legend entry names a series or data item), and nothing has that name: the runtime warns and draws nothing for it.',
		action: 'Use a name the chart has; the suggestion names the closest one.'
	},
	{
		code: 'CFG_UNREGISTERED',
		group: 'runtime',
		title: 'Not registered with a runtime that rejects it',
		meaning:
			'The config names a chart type, scale, component or plugin the runtime does not have, at a place where the runtime refuses unknown names (Chart.js `"x" is not a registered scale`, Highcharts error #17). Claimed only when the registered names are known to be complete.',
		action:
			'Register what the message names (`Chart.register`, `echarts.use`, the Highcharts module), or use a built-in one.'
	},
	{
		code: 'CFG_INEFFECTIVE',
		group: 'runtime',
		title: 'A value the runtime skips',
		meaning:
			'The value is valid but the runtime never applies it: an option of a plugin that is not registered, an update item that matches no series, an option the runtime overrides. Nothing breaks; nothing happens either.',
		action: 'Register what the option belongs to, match the item to an existing series, or remove the option.'
	},
	{
		code: 'CFG_REGISTERED_VARIANT',
		group: 'runtime',
		title: 'A variant an extension registered',
		meaning:
			'The value names a variant (a series type, a scale type) that an extension registers; its options are not checked, since no schema describes them.',
		action: 'Nothing is wrong. To have its options checked, describe the variant in the extension’s schema.'
	},
	{
		code: 'CFG_UNKNOWN_VARIANT',
		group: 'runtime',
		title: 'A variant that is not built in',
		meaning:
			'The value names a variant the library does not ship; it may come from a plugin the validator is not told about, so it is no error, and its options are not checked.',
		action: 'Check the name (a near miss is suggested), or describe the plugin with `withExtensions`.'
	},
	{
		code: 'CFG_AMBIGUOUS',
		group: 'partial',
		title: 'A value that fits several variants',
		meaning:
			'The schema allows several shapes here and the value fits more than one in a way the runtime does not decide from the config (a getter, a coerced value, a variant chosen in a loop), so its contents are not checked further.',
		action: 'Usually nothing; an explicit discriminator (a `type`) lets the value be checked.'
	},
	{
		code: 'CFG_DYNAMIC',
		group: 'partial',
		title: 'A value only running code decides',
		meaning:
			'The value is computed (a call, a variable the analysis cannot follow, an array element built at runtime), so it is not checked and the result is partial.',
		action: 'Nothing is wrong. Write the value as a constant where you want it checked.'
	},
	{
		code: 'CFG_CYCLE',
		group: 'partial',
		title: 'A config that refers to itself',
		meaning: 'An object contains itself; the part below the cycle is not checked again.',
		action: 'Usually nothing; a config the runtime clones may break on a cycle.'
	},
	{
		code: 'CFG_DEPTH',
		group: 'partial',
		title: 'Nested too deeply to check',
		meaning: 'The config nests deeper than the validator walks; what lies below is not checked.',
		action: 'Nothing is wrong; flatten the config if you want it checked.'
	},
	{
		code: 'CFG_TRUNCATED',
		group: 'partial',
		title: 'A work limit was reached',
		meaning:
			'Validating the config, or reading the source it comes from, reached its work bound; the rest is not checked and the values beyond it are unknown.',
		action: 'Nothing is wrong; split a very large config to have all of it checked.'
	},
	{
		code: 'CFG_UNCHECKED',
		group: 'partial',
		title: 'Options checked at creation only',
		meaning:
			'Chart.js merges scale options with their defaults before an update, so the runtime guard checks them when the chart is created, not at each update.',
		action: 'Nothing to do.'
	},
	{
		code: 'CFG_UNSUPPORTED_VERSION',
		group: 'version',
		title: 'A library version the schema does not describe',
		meaning:
			'The version you named has another major version than the schema; options may mean something else there, so nothing is validated.',
		action: 'Use a ChartGuard release whose schema matches your major version, or build the schema for it (Highcharts).'
	},
	{
		code: 'CFG_VERSION_MISMATCH',
		group: 'version',
		title: 'Checked against another minor version',
		meaning:
			'The version you run has the schema’s major version but another minor or patch: an option may be accepted or rejected differently, so confirmed errors are reported as warnings.',
		action: 'Nothing is wrong; for exact results, use the schema of your exact version.'
	},
	{
		code: 'CFG_VERSION_UNKNOWN',
		group: 'version',
		title: 'The running version is not known',
		meaning:
			'A Highcharts chart created elsewhere is checked as the schema’s version, without the series types the running Highcharts has.',
		action: 'Create the chart with `createChart`, or pass the Highcharts namespace in the guard options.'
	},
	{
		code: 'CFG_REGISTRY_CONTEXT',
		group: 'version',
		title: 'Registries that cannot be read',
		meaning:
			'The `registries` option is not a plain object mapping registry ids to `{ names, complete }`; it is ignored as a whole, so nothing is claimed about registration.',
		action: 'Pass the registries as plain data, for example from `registriesOf` of a runtime package.'
	},
	{
		code: 'CFG_UNKNOWN_REGISTRY',
		group: 'version',
		title: 'A registry the schema does not use',
		meaning: 'The `registries` option names a registry id this schema has no use for; it is ignored.',
		action: 'Use one of the ids the message lists.'
	},
	{
		code: 'CFG_SYNTAX',
		group: 'source',
		title: 'A source file with syntax errors',
		meaning:
			'TypeScript could not parse the file cleanly; nothing read from it is reliable, so no finding about its configs is claimed.',
		action: 'Fix the syntax error the message names.'
	},
	{
		code: 'CFG_REASSIGNABLE',
		group: 'source',
		title: 'A config in a variable that may change',
		meaning: 'The config is declared with `let` or `var`; any code may reassign it, so its value is not read.',
		action: 'Declare it with `const` to have it checked.'
	},
	{
		code: 'CFG_MUTATED',
		group: 'source',
		title: 'A config that code changes',
		meaning:
			'Some code writes into the config after it is declared (`config.options.color = …`, `datasets.push(…)`); the paths it writes are left out of the value read.',
		action: 'Nothing is wrong; build the config in one literal to have all of it checked.'
	},
	{
		code: 'CFG_TOO_LARGE',
		group: 'source',
		title: 'A source file too large to read',
		meaning: 'The file is longer than the analysis reads; it is not read at all.',
		action: 'Nothing is wrong; configs in smaller files are checked.'
	},
	{
		code: 'CFG_TOO_COMPLEX',
		group: 'source',
		title: 'A source file nested too deeply',
		meaning:
			'The file nests brackets deeper than the parser can take, or a file it imports does; it is not read rather than risk the parser failing.',
		action: 'Nothing is wrong in your code; it is a limit of the analysis.'
	},
	{
		code: 'CFG_OUTSIDE_PROJECT',
		group: 'source',
		title: 'A file outside the project',
		meaning:
			'A project scan reads only files inside the tsconfig’s directory; this one is outside (an `include` entry or a symbolic link leads out of it), so it is not read.',
		action: 'Scan from a tsconfig whose directory contains the file.'
	},
	{
		code: 'CFG_UNREADABLE',
		group: 'source',
		title: 'A file that cannot be read',
		meaning: 'The file could not be read from disk (permissions, a broken link); the message names the reason.',
		action: 'Make the file readable, or leave it out of the scan.'
	}
];
