/** The user's input cannot be processed; distinct from a failure inside ChartGuard. */
export class InputError extends Error {
	override readonly name = 'InputError';
}

/** An input error about the whole run (a refused plugin schema), never listed against one file among several. */
export class RunInputError extends InputError {}
