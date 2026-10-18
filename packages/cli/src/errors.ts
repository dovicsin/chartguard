/** The user's input cannot be processed; distinct from a failure inside ChartGuard. */
export class InputError extends Error {
	override readonly name = 'InputError';
}
