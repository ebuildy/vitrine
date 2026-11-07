import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { nameToEmoji } from 'gemoji';
import { parse } from 'yaml';
import { z } from 'zod';
import { duplicates, routeProblems, routeSchema } from './router.ts';
import type { Route } from './router.ts';
import { templateProblems } from './template-checks.ts';
import { compileTemplate, TemplateError } from './template-compiler.ts';
import { DEFAULT_CONCURRENCY } from './warm-up.ts';

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

const nexusSourceSchema = z
	.strictObject({
		name: z.string().min(1),
		type: z.literal('nexus'),
		url: z.url(),
		// The Published Repositories. Left out, every Repository the credentials can read is Published.
		repositories: z.array(z.string().min(1)).min(1).optional(),
		username: z.string().optional(),
		passwordEnv: z.string().optional(),
		allowedAgeMinutes: z.number().nonnegative().default(15),
	})
	.refine(({ username, passwordEnv }) => Boolean(username) === Boolean(passwordEnv), {
		message: 'username and passwordEnv must be set together',
	});

const sourceSchema = z.discriminatedUnion('type', [harborSourceSchema, gitlabSourceSchema, nexusSourceSchema]);

const cacheStoreSchema = z.discriminatedUnion('type', [
	z.strictObject({ type: z.literal('memory') }),
	z.strictObject({ type: z.literal('files'), directory: z.string().min(1) }),
	// Installations sharing one Redis each keep their own content under their own prefix.
	z.strictObject({ type: z.literal('redis'), urlEnv: z.string().min(1), keyPrefix: z.string().min(1).default('vitrine:') }),
]);

/** A page-relative address would point somewhere else on every page, and a Container image serves no files of its own. */
const addressSchema = z.string().regex(/^(https?:\/\/|\/)/i, 'must start with http://, https:// or /');

const brandingSchema = z.strictObject({
	siteName: z.string().min(1).default('Vitrine'),
	logo: addressSchema.optional(),
});

/** The logos the build carries, which a Menu item names in Settings: those of the kinds of Source, in src/source-looks.ts. */
const EMBEDDED_ICONS = ['gitlab', 'harbor'] as const satisfies readonly Source['type'][];
type EmbeddedIcon = (typeof EMBEDDED_ICONS)[number];

/** What a Menu item shows before its label: an emoji, a logo of the build, or an image at an address. */
export type MenuIcon = { emoji: string } | { embedded: EmbeddedIcon } | { url: string };

const SHORTCODE = /^:([^:\s]+):$/;
// Not http://, as a browser blocks or warns about an image over plain HTTP on a page served over HTTPS.
const ICON_URL = /^(https:\/\/|\/)/i;

/** Read by its shape, so that a misspelt value fails at startup and not as a Menu with no icon. */
const menuIconSchema = z.string().transform((icon, context): MenuIcon => {
	const shortcode = SHORTCODE.exec(icon)?.[1];
	if (shortcode !== undefined) {
		const emoji = Object.hasOwn(nameToEmoji, shortcode) ? nameToEmoji[shortcode] : undefined;
		if (emoji) return { emoji };
		context.addIssue({ code: 'custom', message: `${icon} is not an emoji shortcode, like :rocket:` });
		return z.NEVER;
	}
	if ((EMBEDDED_ICONS as readonly string[]).includes(icon)) return { embedded: icon as EmbeddedIcon };
	if (ICON_URL.test(icon)) return { url: icon };
	context.addIssue({
		code: 'custom',
		message: `must be an emoji shortcode like :rocket:, one of ${EMBEDDED_ICONS.join(', ')}, or a URL starting with https:// or /`,
	});
	return z.NEVER;
});

const navigationItemSchema = z.strictObject({
	label: z.string().min(1),
	url: addressSchema,
	icon: menuIconSchema.optional(),
});

// The characters of a CSS colour, so that a stray `;` or `}` fails at startup and not as a page with no colours.
const colourSchema = z.string().regex(/^[#\w\s(),.%/-]+$/, 'must be a CSS colour, like "#0a7" or rgb(0 120 200)');

/** CSS ends up inside a <style>, which `</style>` would close early. */
const CLOSES_STYLE = /<\/style/i;
const STYLESHEET_URL = /^(https?:\/\/|\/)/i;
const STYLESHEET_FILE = /^\.\.?\//;

/** CSS has a `{`, unlike a URL or a file, so an item is read by its shape. */
const cssItemSchema = z.string().superRefine((item, context) => {
	if (item.includes('{')) {
		if (CLOSES_STYLE.test(item)) context.addIssue({ code: 'custom', message: 'must not contain </style>' });
	} else if (!STYLESHEET_URL.test(item) && !STYLESHEET_FILE.test(item)) {
		context.addIssue({ code: 'custom', message: 'must be CSS, a URL starting with http://, https:// or /, or a file starting with ./ or ../' });
	}
});

const coloursSchema = {
	primary: colourSchema.optional(),
	background: colourSchema.optional(),
	text: colourSchema.optional(),
	border: colourSchema.optional(),
};

const themeSchema = z.strictObject({
	// Each name has its own stylesheet in src/themes, with a light and a dark mode.
	name: z.enum(['naval']).optional(),
	// The colours of light mode, and under dark, those of dark mode. A colour left out is the Theme's own.
	...coloursSchema,
	dark: z.strictObject(coloursSchema).default({}),
	// After Vitrine's own styles and the named Theme, so that they win.
	css: z.array(cssItemSchema).default([]),
});

const warmUpSchema = z.strictObject({
	// Crawls every page once the server answers, so that the first Visitor does not wait on a Source.
	atStart: z.boolean().default(false),
	// Crawls again on this interval, counted from the start of the server.
	everyMinutes: z.number().positive().optional(),
	// How many pages a warm-up requests at once, so that it does not flood the Sources.
	concurrency: z.number().int().positive().default(DEFAULT_CONCURRENCY),
});

/** A stylesheet the browser loads, or CSS the page carries, read from a file when Settings name one. */
export type Stylesheet = { href: string } | { code: string };

/** Exported so tests can check that the example Settings file shows every option. */
export const settingsSchema = z.strictObject({
	sources: z.array(sourceSchema),
	routes: z.array(routeSchema),
	cacheStore: cacheStoreSchema.default({ type: 'memory' }),
	branding: brandingSchema.prefault({}),
	navigation: z.array(navigationItemSchema).default([]),
	theme: themeSchema.prefault({}),
	warmUp: warmUpSchema.prefault({}),
});

export type HarborSource = z.infer<typeof harborSourceSchema> & { password?: string };
export type GitlabSource = z.infer<typeof gitlabSourceSchema> & { token?: string };
export type NexusSource = z.infer<typeof nexusSourceSchema> & { password?: string };
export type Source = HarborSource | GitlabSource | NexusSource;
export type CacheStoreSettings =
	| Exclude<z.infer<typeof cacheStoreSchema>, { type: 'redis' }>
	| (Extract<z.infer<typeof cacheStoreSchema>, { type: 'redis' }> & { url: string });
export interface Settings {
	sources: Source[];
	routes: Route[];
	cacheStore: CacheStoreSettings;
	branding: z.infer<typeof brandingSchema>;
	navigation: z.infer<typeof navigationItemSchema>[];
	theme: Omit<z.infer<typeof themeSchema>, 'css'> & { css: Stylesheet[] };
	warmUp: z.infer<typeof warmUpSchema>;
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
		// Only a missing file starts with defaults: a file there but unreadable is a mistake to show.
		if (!isMissingFile(error)) throw new SettingsError(path, [error instanceof Error ? error.message : String(error)]);
		console.warn(`no settings found, using defaults: ${path} does not exist`);
		raw = DEFAULT_SETTINGS;
	}

	if (raw === null) throw new SettingsError(path, ['the file is empty, see settings.example.yaml']);

	const parsed = settingsSchema.safeParse(raw);
	if (!parsed.success) {
		throw new SettingsError(
			path,
			parsed.error.issues.map((issue) => `${issue.path.join('.') || 'settings'}: ${issue.message}`),
		);
	}

	const { sources, cacheStore, branding, navigation, theme, warmUp } = parsed.data;
	const { routes, problems: compileProblems } = templatesDisabled(env) ? { routes: parsed.data.routes, problems: [] } : compileRoutes(parsed.data.routes, sources);
	const { stylesheets, problems: cssProblems } = readStylesheets(theme.css, dirname(path));
	const problems = [...sourceProblems(sources, env), ...routeProblems(routes, sources), ...cacheStoreProblems(cacheStore, env), ...compileProblems, ...cssProblems];
	if (problems.length > 0) throw new SettingsError(path, problems);

	return {
		routes,
		branding,
		navigation,
		warmUp,
		theme: { ...theme, css: stylesheets },
		cacheStore: cacheStore.type === 'redis' ? { ...cacheStore, url: env[cacheStore.urlEnv] as string } : cacheStore,
		sources: sources.map((source) =>
			source.type === 'gitlab'
				? { ...source, token: source.tokenEnv ? env[source.tokenEnv] : undefined }
				: { ...source, password: source.passwordEnv ? env[source.passwordEnv] : undefined },
		),
	};
}

/** What a missing Settings file stands for. A file must still name both sections, so that one left out by mistake is reported. */
const DEFAULT_SETTINGS = { sources: [], routes: [] };

function isMissingFile(error: unknown) {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** Any value counts, even `false`, so that a mistyped value never leaves Templates on. */
function templatesDisabled(env: Record<string, string | undefined>) {
	return Boolean(env.VITRINE_TEMPLATE_DISABLE);
}

function compileRoutes(routes: Route[], sources: z.infer<typeof sourceSchema>[]) {
	const problems: string[] = [];
	const compiled = routes.map((route) => {
		if (!route.template) return route;
		try {
			const compiledRoute = { ...route, compiled: compileTemplate(route.template) };
			problems.push(...templateProblems(route, sources));
			return compiledRoute;
		} catch (error) {
			if (!(error instanceof TemplateError)) throw error;
			problems.push(`Route "${route.url}": the Template does not compile: ${error.message}`);
			return route;
		}
	});
	return { routes: compiled, problems };
}

function sourceProblems(sources: z.infer<typeof sourceSchema>[], env: Record<string, string | undefined>) {
	const problems = duplicates(sources.map((source) => source.name)).map((name) => `Source "${name}" is declared twice`);
	for (const source of sources) {
		const { name } = source;
		if (source.type === 'harbor') {
			problems.push(...duplicates(source.projects).map((project) => `Source "${name}" selects Harbor project "${project}" twice`));
		} else if (source.type === 'nexus') {
			problems.push(...duplicates(source.repositories ?? []).map((repository) => `Source "${name}" selects Repository "${repository}" twice`));
		} else {
			problems.push(...duplicates(source.mainGroups).map((group) => `Source "${name}" names Main Group "${group}" twice`));
		}
		const secretEnv = source.type === 'gitlab' ? source.tokenEnv : source.passwordEnv;
		if (secretEnv && !env[secretEnv]) {
			problems.push(`Source "${name}" needs the environment variable ${secretEnv}`);
		}
	}
	return problems;
}

/** Reads the files the Container image cannot serve, from beside Settings, so that they can live in the same ConfigMap. */
function readStylesheets(items: string[], directory: string) {
	const problems: string[] = [];
	const stylesheets = items.map((item, index): Stylesheet => {
		if (item.includes('{')) return { code: item };
		if (STYLESHEET_URL.test(item)) return { href: item };
		try {
			const code = readFileSync(resolve(directory, item), 'utf8');
			if (CLOSES_STYLE.test(code)) problems.push(`theme.css.${index}: ${item} must not contain </style>`);
			return { code };
		} catch (error) {
			problems.push(`theme.css.${index}: cannot read ${item}: ${error instanceof Error ? error.message : String(error)}`);
			return { code: '' };
		}
	});
	return { stylesheets, problems };
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

/** Reads and checks Settings once, before anything is served. Throws a SettingsError, and warns about Templates, which run as code. */
export function prepareSettings() {
	loadEnvFile();
	const urls = getSettings()
		.routes.filter(({ template }) => template)
		.map(({ url }) => `"${url}"`)
		.join(', ');
	if (!urls) return;
	console.warn(
		templatesDisabled(process.env)
			? `VITRINE_TEMPLATE_DISABLE is set, so these Routes ignore their Template: ${urls}`
			: `The Templates of these Routes run as code on the server, so only people trusted with the server may edit Settings: ${urls}`,
	);
}

/** What a Template may print of each Source. It names what to keep, so a secret added to a Source later stays out. */
export function publicSources(sources: Source[]) {
	return sources.map((source) => {
		const { name, type, url } = source;
		if (source.type === 'harbor') return { name, type, url, projects: source.projects };
		if (source.type === 'nexus') return { name, type, url, repositories: source.repositories };
		return { name, type, url, mainGroups: source.mainGroups };
	});
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

export function getGitlabSources(): GitlabSource[] {
	return getSettings().sources.filter((source) => source.type === 'gitlab');
}

export function getNexusSources(): NexusSource[] {
	return getSettings().sources.filter((source) => source.type === 'nexus');
}

export function getNexusSource(name: string): NexusSource {
	const source = getNexusSources().find((candidate) => candidate.name === name);
	if (!source) throw new Error(`Unknown Source "${name}"`);
	return source;
}
