import { runAsEntryPoint } from '../../shared/entry.mjs';
import { renderWith } from './echarts-render.mjs';

/** Every class the runtime has registered, as echarts names them: `<mainType>.<subType>` or `<mainType>`. */
function registeredNames(ComponentModel) {
	const types = ComponentModel.getAllClassMainTypes().flatMap((mainType) =>
		ComponentModel.getClassesByMainType(mainType).map((model) => model.type)
	);
	return [...new Set(types)].sort();
}

async function main([input]) {
	const { option, modules } = JSON.parse(input);
	const core = await import('echarts/core');
	const charts = await import('echarts/charts');
	const components = await import('echarts/components');
	const { SVGRenderer } = await import('echarts/renderers');
	const installers = modules.map((name) => {
		const installer = charts[name] ?? components[name];
		if (installer === undefined) throw new Error(`not an echarts chart or component: ${name}`);
		return installer;
	});
	core.use([SVGRenderer, ...installers]);
	const outcome = renderWith(core, option);
	const registries = { echarts: { names: registeredNames(core.ComponentModel), complete: true } };
	process.stdout.write(JSON.stringify({ outcome, registries }));
	return 0;
}

await runAsEntryPoint(import.meta.url, main);
