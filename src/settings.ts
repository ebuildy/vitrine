import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';

const harborSourceSchema = z.object({
	name: z.string().min(1),
	type: z.literal('harbor'),
	url: z.url(),
	username: z.string().optional(),
	passwordEnv: z.string().optional(),
});

const controllerParamsSchemas = {
	'harbor-images': z.object({ source: z.string(), project: z.string() }),
};

export type ControllerName = keyof typeof controllerParamsSchemas;

const routeSchema = z.object({
	url: z.string().startsWith('/'),
	controller: z.enum(Object.keys(controllerParamsSchemas) as [ControllerName, ...ControllerName[]]),
	params: z.record(z.string(), z.string()).default({}),
});

const settingsSchema = z.object({
	sources: z.array(harborSourceSchema),
	routes: z.array(routeSchema),
});

export type HarborSource = z.infer<typeof harborSourceSchema> & { password?: string };
export type Route = z.infer<typeof routeSchema>;
export interface Settings {
	sources: HarborSource[];
	routes: Route[];
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

	const { sources, routes } = parsed.data;
	const problems = [...sourceProblems(sources, env), ...routeProblems(routes, sources)];
	if (problems.length > 0) throw new SettingsError(path, problems);

	return {
		routes,
		sources: sources.map((source) => ({
			...source,
			password: source.passwordEnv ? env[source.passwordEnv] : undefined,
		})),
	};
}

function sourceProblems(sources: z.infer<typeof harborSourceSchema>[], env: Record<string, string | undefined>) {
	const problems = duplicates(sources.map((source) => source.name)).map((name) => `Source "${name}" is declared twice`);
	for (const { name, passwordEnv } of sources) {
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
			problems.push(...parsed.error.issues.map((issue) => `Route "${url}": parameter ${issue.path.join('.')} is required`));
		} else if (!sources.some((source) => source.name === parsed.data.source)) {
			problems.push(`Route "${url}": unknown Source "${parsed.data.source}"`);
		}
	}
	return problems;
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
