import { z } from 'zod';
// Only types may come from settings.ts: it needs routeSchema as soon as it loads, so importing it here would be a cycle.
import type { GitlabSource, Settings, Source } from './settings.ts';
import type { CompiledTemplate } from './template-compiler.ts';

const navigationArrangementSchema = z.enum(['grid', 'columns', 'list']);

export type NavigationArrangement = z.infer<typeof navigationArrangementSchema>;

const controllerParamsSchemas = {
	navigation: z.strictObject({
		arrangement: navigationArrangementSchema.optional(),
		maxItems: z
			.string()
			.regex(/^[1-9]\d*$/, 'must be a whole number above zero')
			.optional(),
	}),
	harbor: z.strictObject({ source: z.string() }),
	'harbor-images': z
		.strictObject({ source: z.string().optional(), project: z.string().optional() })
		.refine(({ source, project }) => source !== undefined || project === undefined, { message: 'project needs a source' }),
	'gitlab-group': z.strictObject({ source: z.string().optional(), group: z.string() }),
	'gitlab-project': z.strictObject({ source: z.string().optional(), group: z.string(), project: z.string() }),
	'gitlab-roadmap': z.strictObject({ source: z.string().optional(), group: z.string() }),
	'gitlab-issues': z.strictObject({ source: z.string().optional(), group: z.string() }),
};

export type ControllerName = keyof typeof controllerParamsSchemas;

export const controllerSourceTypes: Record<ControllerName, Source['type'] | undefined> = {
	navigation: undefined,
	harbor: 'harbor',
	'harbor-images': 'harbor',
	'gitlab-group': 'gitlab',
	'gitlab-project': 'gitlab',
	'gitlab-roadmap': 'gitlab',
	'gitlab-issues': 'gitlab',
};

export const routeSchema = z.strictObject({
	url: z
		.string()
		.startsWith('/')
		.refine((url) => url === '/' || !url.endsWith('/'), { message: 'must not end with a trailing slash' }),
	controller: z.enum(Object.keys(controllerParamsSchemas) as [ControllerName, ...ControllerName[]]),
	// URL parameters are text, so a number from Settings becomes text too.
	params: z.record(z.string(), z.union([z.string(), z.number().transform(String)])).default({}),
	template: z.string().min(1).optional(),
});

/** Settings adds `compiled` to a Route whose Template runs, so a Route never needs to know whether Templates are disabled. */
export type Route = z.infer<typeof routeSchema> & { compiled?: CompiledTemplate };

export function routeProblems(routes: Route[], sources: Source[]) {
	const problems = duplicates(routes.map((route) => route.url)).map((url) => `Route "${url}" is declared twice`);
	for (const { url, controller, params } of routes) {
		// A URL placeholder has no value until a request comes in, so only its name can be checked here.
		const urlParams = Object.fromEntries(urlParamNames(url).map((name) => [name, name]));
		const parsed = controllerParamsSchemas[controller].safeParse({ ...urlParams, ...params });
		if (!parsed.success) {
			problems.push(...parsed.error.issues.map((issue) => `Route "${url}": ${[...issue.path, issue.message].join(': ')}`));
			continue;
		}
		if (url.split('/').filter(isListSegment).length > 1) {
			problems.push(`Route "${url}": only one :name+ segment is allowed`);
		}
		if (params.source !== undefined && !sources.some((candidate) => candidate.name === params.source && candidate.type === controllerSourceTypes[controller])) {
			problems.push(`Route "${url}": unknown Source "${params.source}"`);
		}
		if (controller === 'harbor' && !routes.some(showsProjectImages)) {
			problems.push(`Route "${url}": needs a harbor-images Route with :source and :project in its URL`);
		}
		if (controller === 'gitlab-group' && !routes.some(showsProjects)) {
			problems.push(`Route "${url}": needs a gitlab-project Route with :group and :project in its URL`);
		}
	}
	return problems;
}

export function duplicates(values: string[]) {
	return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

export function urlParamNames(url: string) {
	return url
		.split('/')
		.filter((segment) => segment.startsWith(':'))
		.map(paramName);
}

function paramName(segment: string) {
	return segment.slice(1).replace(/\+$/, '');
}

function isListSegment(segment: string) {
	return segment.startsWith(':') && segment.endsWith('+');
}

function showsHarborProjects({ url, controller }: Route) {
	return controller === 'harbor' && urlParamNames(url).includes('source');
}

function showsProjectImages({ url, controller }: Route) {
	const names = urlParamNames(url);
	return controller === 'harbor-images' && names.includes('source') && names.includes('project');
}

function showsGroups({ url, controller }: Route) {
	return controller === 'gitlab-group' && urlParamNames(url).includes('group');
}

function showsGroupIssues({ url, controller }: Route) {
	return controller === 'gitlab-issues' && urlParamNames(url).includes('group');
}

function showsRoadmaps({ url, controller }: Route) {
	return controller === 'gitlab-roadmap' && urlParamNames(url).includes('group');
}

function showsProjects({ url, controller }: Route) {
	const names = urlParamNames(url);
	return controller === 'gitlab-project' && names.includes('group') && names.includes('project');
}

/** The Main Group that holds a Group or Project path, which is that path itself for a Main Group. */
export function findMainGroup({ mainGroups }: GitlabSource, path: string): string | undefined {
	return mainGroups.find((mainGroup) => isAtOrBeneath(path, mainGroup));
}

/** Whether a Group or Project path is that Group itself or lies anywhere beneath it. */
export function isAtOrBeneath(path: string, group: string): boolean {
	return path === group || path.startsWith(`${group}/`);
}

/** Finds the first Route matching a URL, skipping any that names an unknown Source or a Group outside every Main Group. */
export function matchRoute({ routes, sources }: Settings, url: string): { route: Route; params: Record<string, string> } | undefined {
	for (const route of routes) {
		const urlParams = matchUrl(route.url, url);
		if (!urlParams) continue;
		const params = resolveSource(route, { ...route.params, ...urlParams }, sources);
		if (params) return { route, params };
	}
	return undefined;
}

function matchUrl(routeUrl: string, url: string) {
	const expected = routeUrl.split('/');
	const actual = joinListSegment(expected, url.split('/'));
	if (expected.length !== actual?.length) return undefined;

	const params: Record<string, string> = {};
	for (const [index, segment] of expected.entries()) {
		if (segment.startsWith(':')) params[paramName(segment)] = actual[index];
		else if (segment !== actual[index]) return undefined;
	}
	return params;
}

/** Joins what a :name+ segment takes: one URL segment or more, none empty, and never the "-" that ends a Group path in GitLab. */
function joinListSegment(expected: string[], actual: string[]) {
	const start = expected.findIndex(isListSegment);
	if (start === -1) return actual;

	const end = actual.length - (expected.length - start - 1);
	const taken = actual.slice(start, end);
	if (taken.length === 0 || taken.some((segment) => segment === '' || segment === '-')) return undefined;
	return [...actual.slice(0, start), taken.join('/'), ...actual.slice(end)];
}

function resolveSource({ controller }: Route, params: Record<string, string>, sources: Source[]) {
	const { source, group } = params;
	if (group !== undefined) {
		// A Route may leave out the Source, which is then the first one with a Main Group holding the Group.
		const found = sources.find((candidate) => candidate.type === 'gitlab' && (source ?? candidate.name) === candidate.name && findMainGroup(candidate, group));
		return found && { ...params, source: found.name };
	}
	const known = sources.some(({ name, type }) => name === source && type === controllerSourceTypes[controller]);
	return source === undefined || known ? params : undefined;
}

/** The URL showing the Images of one Harbor project, if a Route offers one. */
export function harborImagesUrl(routes: Route[], source: string, project: string): string | undefined {
	return routes.find(showsProjectImages)?.url.replace(':source', encodeURIComponent(source)).replace(':project', encodeURIComponent(project));
}

/** The URLs that need no value from anyone, which are all a page can link to without knowing what a Route shows. */
export function fixedUrls(routes: Route[]): string[] {
	return routes.map(({ url }) => url).filter((url) => urlParamNames(url).length === 0);
}

/** The URL listing the Harbor projects of one Source, if a Route offers one. */
export function harborProjectsUrl(routes: Route[], source: string): string | undefined {
	return routes.find(showsHarborProjects)?.url.replace(':source', encodeURIComponent(source));
}

/** The URL showing one Group, if a Route offers one. */
export function gitlabGroupUrl(routes: Route[], source: string, group: string): string | undefined {
	return gitlabUrl(routes, showsGroups, source, group);
}

/** The URL showing the Issues of one Group, if a Route offers one. */
export function gitlabIssuesUrl(routes: Route[], source: string, group: string): string | undefined {
	return gitlabUrl(routes, showsGroupIssues, source, group);
}

/** The URL showing the Roadmap of one Main Group, if a Route offers one. */
export function gitlabRoadmapUrl(routes: Route[], source: string, group: string): string | undefined {
	return gitlabUrl(routes, showsRoadmaps, source, group);
}

/** The URL showing one Project, if a Route offers one. */
export function gitlabProjectUrl(routes: Route[], source: string, path: string): string | undefined {
	const separator = path.lastIndexOf('/');
	return gitlabUrl(routes, showsProjects, source, path.slice(0, separator))?.replace(':project', encodeURIComponent(path.slice(separator + 1)));
}

function gitlabUrl(routes: Route[], shows: (route: Route) => boolean, source: string, group: string) {
	return routes
		.find((route) => shows(route) && (route.params.source ?? source) === source)
		?.url.replace(':source', encodeURIComponent(source))
		.replace(/:group\+?/, encodeURI(group));
}
