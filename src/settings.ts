import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';

const harborSourceSchema = z
	.strictObject({
		name: z.string().min(1),
		type: z.literal('harbor'),
		url: z.url(),
		projects: z.array(z.string().min(1)).min(1),
		username: z.string().optional(),
		passwordEnv: z.string().optional(),
		allowedAgeMinutes: z.number().nonnegative().default(15),
	})
	.refine(({ username, passwordEnv }) => Boolean(username) === Boolean(passwordEnv), {
		message: 'username and passwordEnv must be set together',
	});

const gitlabSourceSchema = z.strictObject({
	name: z.string().min(1),
	type: z.literal('gitlab'),
	url: z.url(),
	mainGroups: z.array(z.string().regex(/^[^/]+(\/[^/]+)*$/, 'must be a Group path, like platform or platform/backend')).min(1),
	tokenEnv: z.string().optional(),
	allowedAgeMinutes: z.number().nonnegative().default(15),
});

const sourceSchema = z.discriminatedUnion('type', [harborSourceSchema, gitlabSourceSchema]);

const controllerParamsSchemas = {
	harbor: z.strictObject({ source: z.string() }),
	'harbor-images': z
		.strictObject({ source: z.string().optional(), project: z.string().optional() })
		.refine(({ source, project }) => source !== undefined || project === undefined, { message: 'project needs a source' }),
	'gitlab-group': z.strictObject({ source: z.string().optional(), group: z.string() }),
	'gitlab-project': z.strictObject({ source: z.string().optional(), group: z.string(), project: z.string() }),
};

export type ControllerName = keyof typeof controllerParamsSchemas;

const controllerSourceTypes: Record<ControllerName, z.infer<typeof sourceSchema>['type']> = {
	harbor: 'harbor',
	'harbor-images': 'harbor',
	'gitlab-group': 'gitlab',
	'gitlab-project': 'gitlab',
};

const routeSchema = z.strictObject({
	url: z
		.string()
		.startsWith('/')
		.refine((url) => url === '/' || !url.endsWith('/'), { message: 'must not end with a trailing slash' }),
	controller: z.enum(Object.keys(controllerParamsSchemas) as [ControllerName, ...ControllerName[]]),
	params: z.record(z.string(), z.string()).default({}),
});

const cacheStoreSchema = z.discriminatedUnion('type', [
	z.strictObject({ type: z.literal('memory') }),
	z.strictObject({ type: z.literal('files'), directory: z.string().min(1) }),
	z.strictObject({ type: z.literal('redis'), urlEnv: z.string().min(1) }),
]);

const settingsSchema = z.strictObject({
	sources: z.array(sourceSchema),
	routes: z.array(routeSchema),
	cacheStore: cacheStoreSchema.default({ type: 'memory' }),
});

export type HarborSource = z.infer<typeof harborSourceSchema> & { password?: string };
export type GitlabSource = z.infer<typeof gitlabSourceSchema> & { token?: string };
export type Source = HarborSource | GitlabSource;
export type Route = z.infer<typeof routeSchema>;
export type CacheStoreSettings =
	| Exclude<z.infer<typeof cacheStoreSchema>, { type: 'redis' }>
	| (Extract<z.infer<typeof cacheStoreSchema>, { type: 'redis' }> & { url: string });
export interface Settings {
	sources: Source[];
	routes: Route[];
	cacheStore: CacheStoreSettings;
}

export class SettingsError extends Error {
	constructor(path: string, problems: string[]) {
		super(`Invalid Settings in ${path}:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
		this.name = 'SettingsError';
	}
}

export function loadSettings(path: string, env: Record<string, string | undefined> = process.env): Settings {
	let raw: unknown;
	try {
		raw = parse(readFileSync(path, 'utf8'));
	} catch (error) {
		throw new SettingsError(path, [error instanceof Error ? error.message : String(error)]);
	}

	if (raw === null) throw new SettingsError(path, ['the file is empty, see settings.example.yaml']);

	const parsed = settingsSchema.safeParse(raw);
	if (!parsed.success) {
		throw new SettingsError(
			path,
			parsed.error.issues.map((issue) => `${issue.path.join('.') || 'settings'}: ${issue.message}`),
		);
	}

	const { sources, routes, cacheStore } = parsed.data;
	const problems = [...sourceProblems(sources, env), ...routeProblems(routes, sources), ...cacheStoreProblems(cacheStore, env)];
	if (problems.length > 0) throw new SettingsError(path, problems);

	return {
		routes,
		cacheStore: cacheStore.type === 'redis' ? { ...cacheStore, url: env[cacheStore.urlEnv] as string } : cacheStore,
		sources: sources.map((source) =>
			source.type === 'harbor'
				? { ...source, password: source.passwordEnv ? env[source.passwordEnv] : undefined }
				: { ...source, token: source.tokenEnv ? env[source.tokenEnv] : undefined },
		),
	};
}

function sourceProblems(sources: z.infer<typeof sourceSchema>[], env: Record<string, string | undefined>) {
	const problems = duplicates(sources.map((source) => source.name)).map((name) => `Source "${name}" is declared twice`);
	for (const source of sources) {
		const { name } = source;
		if (source.type === 'harbor') {
			problems.push(...duplicates(source.projects).map((project) => `Source "${name}" selects Harbor project "${project}" twice`));
		} else {
			problems.push(...duplicates(source.mainGroups).map((group) => `Source "${name}" names Main Group "${group}" twice`));
		}
		const secretEnv = source.type === 'harbor' ? source.passwordEnv : source.tokenEnv;
		if (secretEnv && !env[secretEnv]) {
			problems.push(`Source "${name}" needs the environment variable ${secretEnv}`);
		}
	}
	return problems;
}

function routeProblems(routes: Route[], sources: z.infer<typeof sourceSchema>[]) {
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

function urlParamNames(url: string) {
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

function showsProjectImages({ url, controller }: Route) {
	const names = urlParamNames(url);
	return controller === 'harbor-images' && names.includes('source') && names.includes('project');
}

function showsGroups({ url, controller }: Route) {
	return controller === 'gitlab-group' && urlParamNames(url).includes('group');
}

function showsProjects({ url, controller }: Route) {
	const names = urlParamNames(url);
	return controller === 'gitlab-project' && names.includes('group') && names.includes('project');
}

function cacheStoreProblems(cacheStore: z.infer<typeof cacheStoreSchema>, env: Record<string, string | undefined>) {
	return cacheStore.type === 'redis' && !env[cacheStore.urlEnv] ? [`The Redis cache store needs the environment variable ${cacheStore.urlEnv}`] : [];
}

function duplicates(values: string[]) {
	return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

const loaded = new Map<string, Settings>();

export function getSettings(): Settings {
	const path = process.env.VITRINE_SETTINGS ?? 'settings.yaml';
	const settings = loaded.get(path) ?? loadSettings(path);
	loaded.set(path, settings);
	return settings;
}

export function getHarborSources(): HarborSource[] {
	return getSettings().sources.filter((source) => source.type === 'harbor');
}

export function getHarborSource(name: string): HarborSource {
	const source = getHarborSources().find((candidate) => candidate.name === name);
	if (!source) throw new Error(`Unknown Source "${name}"`);
	return source;
}

export function getGitlabSource(name: string): GitlabSource {
	const source = getGitlabSources().find((candidate) => candidate.name === name);
	if (!source) throw new Error(`Unknown Source "${name}"`);
	return source;
}

function getGitlabSources(): GitlabSource[] {
	return getSettings().sources.filter((source) => source.type === 'gitlab');
}

/** The Main Group that holds a Group or Project path, which is that path itself for a Main Group. */
export function findMainGroup({ mainGroups }: GitlabSource, path: string): string | undefined {
	return mainGroups.find((mainGroup) => path === mainGroup || path.startsWith(`${mainGroup}/`));
}

/** Finds the first Route matching a URL, skipping any that names an unknown Source or a Group outside every Main Group. */
export function matchRoute(url: string): { route: Route; params: Record<string, string> } | undefined {
	for (const route of getSettings().routes) {
		const urlParams = matchUrl(route.url, url);
		if (!urlParams) continue;
		const params = resolveSource(route, { ...route.params, ...urlParams });
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

function resolveSource({ controller }: Route, params: Record<string, string>) {
	const { source, group } = params;
	if (group !== undefined) {
		// A Route may leave out the Source, which is then the first one with a Main Group holding the Group.
		const found = getGitlabSources().find((candidate) => (source ?? candidate.name) === candidate.name && findMainGroup(candidate, group));
		return found && { ...params, source: found.name };
	}
	const known = getSettings().sources.some(({ name, type }) => name === source && type === controllerSourceTypes[controller]);
	return source === undefined || known ? params : undefined;
}

/** The URL showing the Images of one Harbor project, if a Route offers one. */
export function harborImagesUrl(source: string, project: string): string | undefined {
	return getSettings()
		.routes.find(showsProjectImages)
		?.url.replace(':source', encodeURIComponent(source))
		.replace(':project', encodeURIComponent(project));
}

/** The URL showing one Group, if a Route offers one. */
export function gitlabGroupUrl(source: string, group: string): string | undefined {
	return gitlabUrl(showsGroups, source, group);
}

/** The URL showing one Project, if a Route offers one. */
export function gitlabProjectUrl(source: string, path: string): string | undefined {
	const separator = path.lastIndexOf('/');
	return gitlabUrl(showsProjects, source, path.slice(0, separator))?.replace(':project', encodeURIComponent(path.slice(separator + 1)));
}

function gitlabUrl(shows: (route: Route) => boolean, source: string, group: string) {
	return getSettings()
		.routes.find((route) => shows(route) && (route.params.source ?? source) === source)
		?.url.replace(':source', encodeURIComponent(source))
		.replace(/:group\+?/, encodeURI(group));
}
