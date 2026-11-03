import type * as SourceChecks from '@chartguard/source-checks/text';

import type { Library, LibraryId } from './libraries.js';
import type { Adapter } from './model.js';
import type { Renderer } from './runtime.js';
import { engineOf, fileNameOf, type Language, type SourceView, sourceView } from './source.js';

/** What the editor holds: a JSON config, or JavaScript or TypeScript source. */
export type Mode = 'json' | Language;
export const MODES: readonly Mode[] = ['json', 'javascript', 'typescript'];

/**
 * The adapters, runtimes and source checks the page has loaded: each a lazily loaded chunk, loaded
 * once (TypeScript and the analysis only in source mode).
 */
export class Tools {
	private readonly adapters = new Map<LibraryId, Adapter>();
	private readonly renderers = new Map<LibraryId, Renderer | undefined>();
	private checks: typeof SourceChecks | undefined;

	async load(libraries: readonly Library[], source: boolean): Promise<void> {
		const missing = libraries.filter(({ id }) => !this.adapters.has(id));
		const loaded = await Promise.all(missing.map((library) => Promise.all([library.adapter(), library.renderer?.()])));
		for (const [index, [adapter, renderer]] of loaded.entries()) {
			const id = missing[index]?.id;
			if (id === undefined) continue;
			this.adapters.set(id, adapter);
			this.renderers.set(id, renderer);
		}
		if (source) this.checks ??= await import('@chartguard/source-checks/text');
	}

	adapter(id: LibraryId): Adapter | undefined {
		return this.adapters.get(id);
	}

	renderer(id: LibraryId): Renderer | undefined {
		return this.renderers.get(id);
	}

	/** The editors' findings about `text` (undefined until the source checks and every adapter are loaded). */
	source(text: string, language: Language, chart: number): SourceView | undefined {
		const { chartjs, echarts, highcharts } = Object.fromEntries(this.adapters) as Partial<Record<LibraryId, Adapter>>;
		if (this.checks === undefined || chartjs === undefined || echarts === undefined || highcharts === undefined)
			return undefined;
		const check = this.checks.checkText(text, fileNameOf(language), engineOf({ chartjs, echarts, highcharts }));
		return sourceView(check, chart);
	}
}
