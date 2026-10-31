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

const controllerParamsSchemas = {
	harbor: z.strictObject({ source: z.string() }),
	'harbor-images': z
		.strictObject({ source: z.string().optional(), project: z.string().optional() })
		.refine(({ source, project }) => source !== undefined || project === undefined, { message: 'project needs a source' }),
};

export type ControllerName = keyof typeof controllerParamsSchemas;

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
	sources: z.array(harborSourceSchema),
	routes: z.array(routeSchema),
	cacheStore: cacheStoreSchema.default({ type: 'memory' }),
});

export type HarborSource = z.infer<typeof harborSourceSchema> & { password?: string };
export type Route = z.infer<typeof routeSchema>;
export type CacheStoreSettings =
	| Exclude<z.infer<typeof cacheStoreSchema>, { type: 'redis' }>
	| (Extract<z.infer<typeof cacheStoreSchema>, { type: 'redis' }> & { url: string });
export interface Settings {
	sources: HarborSource[];
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
		sources: sources.map((source) => ({
			...source,
			password: source.passwordEnv ? env[source.passwordEnv] : undefined,
		})),
	};
}

function sourceProblems(sources: z.infer<typeof harborSourceSchema>[], env: Record<string, string | undefined>) {
	const problems = duplicates(sources.map((source) => source.name)).map((name) => `Source "${name}" is declared twice`);
	for (const { name, projects, passwordEnv } of sources) {
		problems.push(...duplicates(projects).map((project) => `Source "${name}" selects Harbor project "${project}" twice`));
		if (passwordEnv && !env[passwordEnv]) {
			problems.push(`Source "${name}" needs the environment variable ${passwordEnv}`);
		}
	}
	return problems;
}

function routeProblems(routes: Route[], sources: z.infer<typeof harborSourceSchema>[]) {
	const problems = duplicates(routes.map((route) => route.url)).map((url) => `Route "${url}" is declared twice`);
	for (const { url, controller, params } of routes) {
		// A URL placeholder has no value until a request comes in, so only its name can be checked here.
		const urlParams = Object.fromEntries(urlParamNames(url).map((name) => [name, name]));
		const parsed = controllerParamsSchemas[controller].safeParse({ ...urlParams, ...params });
		if (!parsed.success) {
			problems.push(...parsed.error.issues.map((issue) => `Route "${url}": ${[...issue.path, issue.message].join(': ')}`));
			continue;
		}
		if (params.source !== undefined && !sources.some((candidate) => candidate.name === params.source)) {
			problems.push(`Route "${url}": unknown Source "${params.source}"`);
		}
		if (controller === 'harbor' && !routes.some(showsProjectImages)) {
			problems.push(`Route "${url}": needs a harbor-images Route with :source and :project in its URL`);
		}
	}
	return problems;
}

function urlParamNames(url: string) {
	return url
		.split('/')
		.filter((segment) => segment.startsWith(':'))
		.map((segment) => segment.slice(1));
}

function showsProjectImages({ url, controller }: Route) {
	const names = urlParamNames(url);
	return controller === 'harbor-images' && names.includes('source') && names.includes('project');
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

export function getHarborSource(name: string): HarborSource {
	const source = getSettings().sources.find((candidate) => candidate.name === name);
	if (!source) throw new Error(`Unknown Source "${name}"`);
	return source;
}

/** Finds the first Route matching a URL, skipping any whose URL names an unknown Source. */
export function matchRoute(url: string): { route: Route; params: Record<string, string> } | undefined {
	for (const route of getSettings().routes) {
		const urlParams = matchUrl(route.url, url);
		if (!urlParams) continue;
		const params = { ...route.params, ...urlParams };
		if (isKnownSource(params.source)) return { route, params };
	}
	return undefined;
}

function matchUrl(routeUrl: string, url: string) {
	const expected = routeUrl.split('/');
	const actual = url.split('/');
	if (expected.length !== actual.length) return undefined;

	const params: Record<string, string> = {};
	for (const [index, segment] of expected.entries()) {
		if (segment.startsWith(':')) params[segment.slice(1)] = actual[index];
		else if (segment !== actual[index]) return undefined;
	}
	return params;
}

function isKnownSource(source: string | undefined) {
	return source === undefined || getSettings().sources.some((candidate) => candidate.name === source);
}

/** The URL showing the Images of one Harbor project, if a Route offers one. */
export function harborImagesUrl(source: string, project: string): string | undefined {
	return getSettings()
		.routes.find(showsProjectImages)
		?.url.replace(':source', encodeURIComponent(source))
		.replace(':project', encodeURIComponent(project));
}
