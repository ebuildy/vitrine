import { transform } from '@astrojs/compiler-rs';
import type { AstroComponentFactory } from 'astro/runtime/server/index.js';
import { componentList } from './component-list.ts';

/** What a Template reads as plain variables, besides every Component. A value the page lacks is undefined. */
const TEMPLATE_VALUES =['source', 'group', 'project', 'path', 'title', 'description', 'sources'];

/** The parts of Astro's runtime a compiled Template calls. The page hands in its own, as a second copy would not recognise its Components. */
type Runtime = Record<string, unknown> & { markHTMLString: (html: string) => string };

/** Gives back the Template as a component that reads the scope of one request. */
export type CompiledTemplate = (runtime: Runtime, scope: Record<string, unknown>) => AstroComponentFactory;

export class TemplateError extends Error {}

const FILENAME = '/vitrine/template.astro';

// The compiler always writes this first, and the default export last, so neither can match markup in between.
const RUNTIME_IMPORT = /^import \{ (.+?) \} from "astro\/runtime\/server\/index\.js";\n/;
const DEFAULT_EXPORT = /export default (\$\$\w+);\s*$/;

/**
 * Compiles a Template into code that runs with no build: `inlineComponentAssets` keeps its CSS out of the imports only a build
 * can resolve, and `resolvePath` drops the metadata that would need them. Throws a TemplateError for a Template that cannot run.
 */
export function compileTemplate(template: string): CompiledTemplate {
	const { code, scripts, diagnostics } = transform(template, { filename: FILENAME, inlineComponentAssets: true, resolvePath: (specifier) => specifier });
	const failure = diagnostics.find(({ severity }) => severity === 'error');
	if (failure) throw new TemplateError(`${failure.text}, on line ${failure.labels[0]?.line}`);

	const runtimeNames = RUNTIME_IMPORT.exec(code)?.[1].replaceAll(' as ', ': ');
	const names = [...Object.keys(componentList), ...TEMPLATE_VALUES];
	const body = code.replace(RUNTIME_IMPORT, '').replace(DEFAULT_EXPORT, (_, component) => `return ${component};`);

	let instantiate: CompiledTemplate;
	try {
		// Modules are strict, and an `import` left in the frontmatter is a syntax error here, as it has nothing to load.
		instantiate = new Function('$$runtime', '$$scope', `'use strict'; const { ${runtimeNames} } = $$runtime; const { ${names.join(', ')} } = $$scope;\n${body}`) as CompiledTemplate;
	} catch (error) {
		throw new TemplateError((error as Error).message);
	}

	return (runtime, scope) =>
		instantiate(
			{
				...runtime,
				// <head> stays the Layout's.
				maybeRenderHead: () => '',
				// A script normally becomes a file of the build, so the page carries it instead.
				renderScript: (_result: unknown, id: string) => {
					const script = scripts[Number(/index=(\d+)/.exec(id)?.[1])];
					return runtime.markHTMLString(script.type === 'external' ? `<script type="module" src="${script.src}"></script>` : `<script type="module">${script.code}</script>`);
				},
			},
			scope,
		);
}
