import { parse } from '@astrojs/compiler-rs';
import { componentList } from './component-list.ts';
import type { ComponentEntry } from './component-list.ts';
import { controllerSourceTypes, findMainGroup, urlParamNames } from './router.ts';
import type { Route } from './router.ts';
import type { GitlabSource, Source } from './settings.ts';

// The compiler's tree has too many kinds of node to name, and these checks only read a few fields of a few of them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = Record<string, any>;

const FUNCTIONS = ['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'];
const BUILT_IN_TAGS = /^(Fragment$|Astro\.)/;

/** Reports what can be told about a Template that compiles without calling a Source, wherever a tag appears. Computed values stay unchecked. */
export function templateProblems(route: Route, sources: Source[]): string[] {
	const tree = parse(route.template ?? '').ast;
	const rebound = reboundNames(tree);
	const problems: string[] = [];
	walk(tree, (node) => {
		if (node.type !== 'JSXOpeningElement') return;
		const name = tagName(node.name);
		if (!/^[A-Z]/.test(name) || BUILT_IN_TAGS.test(name)) return;
		const entry = componentList[name];
		if (!entry) problems.push(`<${name}> is not a Component`);
		else problems.push(...tagProblems(name, entry, node.attributes, route, sources, rebound));
	});
	return problems.map((problem) => `Route "${route.url}": the Template is wrong: ${problem}`);
}

function tagName(name: Node): string {
	return name.type === 'JSXMemberExpression' ? `${tagName(name.object)}.${name.property.name}` : name.name;
}

function tagProblems(name: string, { props, sourceType }: ComponentEntry, attributes: Node[], route: Route, sources: Source[], rebound: Set<string>) {
	const given = new Map<string, Node | undefined>(attributes.filter(({ type }) => type === 'JSXAttribute').map(({ name, value }) => [name.name, value?.expression ?? value]));
	const problems = attributes.some(({ type }) => type === 'JSXSpreadAttribute') ? [] : propProblems(name, props, given);

	const fixed = (prop: string) => fixedValue(given.get(prop), route, rebound);
	const source = fixed('source');
	const found = sources.find((candidate) => candidate.name === source);
	const type = source === undefined ? routeSourceType(given.get('source'), route, rebound) : found?.type;
	if (source !== undefined && !found) problems.push(`<${name}> names unknown Source "${source}"`);
	if (type && type !== sourceType) problems.push(`<${name}> needs a ${sourceType} Source, and gets a ${type} one`);

	if (sourceType === 'gitlab') {
		const gitlabSources = sources.filter((candidate): candidate is GitlabSource => candidate.type === 'gitlab' && (source === undefined || candidate.name === source));
		for (const value of [fixed('group'), fixed('project')]) {
			if (value !== undefined && !gitlabSources.some((candidate) => findMainGroup(candidate, value))) {
				problems.push(`<${name}> shows "${value}", but "${value}" is outside every Main Group`);
			}
		}
	}
	return problems;
}

function propProblems(name: string, props: ComponentEntry['props'], given: Map<string, Node | undefined>) {
	return [
		...Object.entries(props)
			.filter(([prop, required]) => required && !given.has(prop))
			.map(([prop]) => `<${name}> needs the prop "${prop}"`),
		...[...given.keys()].filter((prop) => !(prop in props)).map((prop) => `<${name}> has no prop "${prop}"`),
	];
}

/** The value a prop is sure to have: one written in the Template, or a Route value fixed by the Route's `params` and not by its URL, which wins. */
function fixedValue(value: Node | undefined, { url, params }: Route, rebound: Set<string>): string | undefined {
	if (value?.type === 'Literal' && typeof value.value === 'string') return value.value;
	if (value?.type === 'TemplateLiteral' && value.expressions.length === 0) return value.quasis[0].value.cooked;
	if (isRouteValue(value, rebound) && !urlParamNames(url).includes(value?.name)) return params[value?.name];
	return undefined;
}

/** A `source` taken from the URL is not known yet, but the Route only matches Sources of its Controller's type. */
function routeSourceType(value: Node | undefined, { controller }: Route, rebound: Set<string>) {
	return value?.name === 'source' && isRouteValue(value, rebound) ? controllerSourceTypes[controller] : undefined;
}

function isRouteValue(value: Node | undefined, rebound: Set<string>) {
	return value?.type === 'Identifier' && !rebound.has(value.name);
}

/** Every name a Template binds itself. Where it binds one does not matter: treating the name as computed everywhere only skips a check. */
function reboundNames(tree: Node) {
	const names = new Set<string>();
	const collect = (pattern: Node) =>
		walk(pattern, (node) => {
			if (node.type === 'Identifier') names.add(node.name);
		});
	walk(tree, (node) => {
		if (node.type === 'VariableDeclarator') collect(node.id);
		if (FUNCTIONS.includes(node.type)) collect(node.params);
	});
	return names;
}

function walk(node: unknown, visit: (node: Node) => void) {
	if (typeof node !== 'object' || node === null) return;
	if (!Array.isArray(node)) visit(node);
	for (const child of Object.values(node)) walk(child, visit);
}
