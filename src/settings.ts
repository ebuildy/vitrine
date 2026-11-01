import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';
import { duplicates, routeProblems, routeSchema } from './router.ts';
import type { Route } from './router.ts';

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

function cacheStoreProblems(cacheStore: z.infer<typeof cacheStoreSchema>, env: Record<string, string | undefined>) {
	return cacheStore.type === 'redis' && !env[cacheStore.urlEnv] ? [`The Redis cache store needs the environment variable ${cacheStore.urlEnv}`] : [];
}

/** Reads the secrets kept out of the environment for local work. A variable the environment already sets wins. */
export function loadEnvFile() {
	const path = process.env.VITRINE_ENV_FILE ?? '.env';
	if (existsSync(path)) process.loadEnvFile(path);
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
