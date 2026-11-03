import type * as SourceChecks from '@chartguard/source-checks/text';

import type { Library, LibraryId } from './libraries.js';
import type { Adapter } from './model.js';
import { engineOf, fileNameOf, type Language, type SourceView, sourceView } from './source.js';
import type * as Transpiler from './transpile.js';

/** What the editor holds: a JSON config, or JavaScript or TypeScript source. */
export type Mode = 'json' | Language;
export const MODES: readonly Mode[] = ['json', 'javascript', 'typescript'];

/**
 * The adapters and source checks the page has loaded: each a lazily loaded chunk, loaded once
 * (TypeScript and the analysis only in source mode). The runtimes live in the drawing frames.
 */
export class Tools {
	private readonly adapters = new Map<LibraryId, Adapter>();
	private checks: typeof SourceChecks | undefined;
	private transpiler: typeof Transpiler | undefined;

	async load(libraries: readonly Library[], source: boolean): Promise<void> {
		const missing = libraries.filter(({ id }) => !this.adapters.has(id));
		const loaded = await Promise.all(missing.map((library) => library.adapter()));
		for (const [index, adapter] of loaded.entries()) {
			const id = missing[index]?.id;
			if (id !== undefined) this.adapters.set(id, adapter);
		}
		if (source) {
			this.checks ??= await import('@chartguard/source-checks/text');
			this.transpiler ??= await import('./transpile.js');
		}
	}

	adapter(id: LibraryId): Adapter | undefined {
		return this.adapters.get(id);
	}

	/** The editors' findings about `text` (undefined until the source checks and every adapter are loaded). */
	source(text: string, language: Language, chart: number): SourceView | undefined {
		const { chartjs, echarts, highcharts } = Object.fromEntries(this.adapters) as Partial<Record<LibraryId, Adapter>>;
		if (this.checks === undefined || chartjs === undefined || echarts === undefined || highcharts === undefined)
			return undefined;
		const check = this.checks.checkText(text, fileNameOf(language), engineOf({ chartjs, echarts, highcharts }));
		return sourceView(check, chart);
	}

	/** The source as the frame runs it (CommonJS), or undefined until the source checks are loaded. */
	transpiled(text: string, language: Language): string | undefined {
		return this.transpiler?.transpile(text, fileNameOf(language));
	}
}
