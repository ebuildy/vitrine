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
	'harbor-images': z.strictObject({ source: z.string().optional() }),
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
		const parsed = controllerParamsSchemas[controller].safeParse(params);
		if (!parsed.success) {
			problems.push(...parsed.error.issues.map((issue) => `Route "${url}": ${[...issue.path, issue.message].join(': ')}`));
			continue;
		}
		const source = 'source' in parsed.data ? parsed.data.source : undefined;
		if (source !== undefined && !sources.some((candidate) => candidate.name === source)) {
			problems.push(`Route "${url}": unknown Source "${source}"`);
		}
	}
	return problems;
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
