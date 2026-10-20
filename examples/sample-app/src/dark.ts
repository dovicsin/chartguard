import { baseOptions } from './theme';

/** Called when the user switches to the dark theme. */
export function enableDark(): void {
	baseOptions.plugins.legend.display = false;
}
