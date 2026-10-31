import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { startFakeHarbor } from './support/fake-harbor.ts';
import type { FakeHarbor } from './support/fake-harbor.ts';
import { devStartupFailure, runBuiltEntryDirectly, startupFailure, startVitrine } from './support/vitrine.ts';
import type { RunningVitrine } from './support/vitrine.ts';

const artifact = {
	size: 1024,
	push_time: '2026-10-01T08:00:00.000Z',
	tags: [{ name: '1.0', push_time: '2026-10-01T08:00:00.000Z' }],
};

describe('a Route to the harbor-images Controller', () => {
	let harbor: FakeHarbor;
	let vitrine: RunningVitrine;

	beforeAll(async () => {
		harbor = await startFakeHarbor({ projects: { platform: ['platform/api', 'platform/worker'] } });
		vitrine = await startVitrine({
			sources: [{ name: 'main-harbor', type: 'harbor', url: harbor.url, projects: ['platform'] }],
			routes: [
				{ url: '/images', controller: 'harbor-images' },
				{ url: '/', controller: 'harbor-images' },
				{ url: '/fork-page', controller: 'harbor-images' },
			],
		});
	});

	afterAll(async () => {
		await vitrine?.stop();
		await harbor?.stop();
	});

	test('shows the Images of the selected Harbor project', async () => {
		const response = await fetch(`${vitrine.url}/images`);

		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain('platform/api');
		expect(html).toContain('platform/worker');
	});

	test('serves a Route at the root URL', async () => {
		expect((await fetch(`${vitrine.url}/`)).status).toBe(200);
	});

	test('returns a not-found page for a URL with no Route', async () => {
		const response = await fetch(`${vitrine.url}/nowhere`);

		expect(response.status).toBe(404);
		expect(await response.text()).toContain('Page not found');
	});

	test('gives way to a page from a fork at the same URL', async () => {
		const response = await fetch(`${vitrine.url}/fork-page`);

		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain('A page from a fork');
		expect(html).toContain('platform/api');
	});
});

describe('a Route over several Harbor Sources', () => {
	let harbors: FakeHarbor[];
	let vitrine: RunningVitrine;

	beforeAll(async () => {
		harbors = await Promise.all([
			startFakeHarbor({
				projects: { platform: ['platform/api'], data: ['data/etl'], hidden: ['hidden/secret'] },
				artifacts: { 'platform/api': [artifact], 'data/etl': [artifact] },
			}),
			startFakeHarbor({ projects: { tools: ['tools/cli'] }, artifacts: { 'tools/cli': [artifact] } }),
		]);
		vitrine = await startVitrine({
			sources: [
				{ name: 'main-harbor', type: 'harbor', url: harbors[0].url, projects: ['platform', 'data'] },
				{ name: 'tools-harbor', type: 'harbor', url: harbors[1].url, projects: ['tools'] },
			],
			routes: [
				{ url: '/images', controller: 'harbor-images' },
				{ url: '/tools', controller: 'harbor-images', params: { source: 'tools-harbor' } },
			],
		});
	});

	afterAll(async () => {
		await vitrine?.stop();
		await Promise.all(harbors.map((harbor) => harbor.stop()));
	});

	afterEach(() => {
		harbors[1].behave('up');
	});

	test('shows the Images of every selected Harbor project of every Source', async () => {
		const html = await (await fetch(`${vitrine.url}/images`)).text();

		expect(html).toContain('platform/api');
		expect(html).toContain('data/etl');
		expect(html).toContain('tools/cli');
		expect(html).toContain(`${new URL(harbors[1].url).host}/tools/cli:1.0`);
	});

	test('leaves out a Harbor project that is not selected', async () => {
		const html = await (await fetch(`${vitrine.url}/images`)).text();

		expect(html).not.toContain('hidden/secret');
		expect(harbors[0].requests.filter((request) => request.includes('hidden'))).toEqual([]);
	});

	test('can be limited to one Source', async () => {
		const html = await (await fetch(`${vitrine.url}/tools`)).text();

		expect(html).toContain('tools/cli');
		expect(html).not.toContain('platform/api');
	});

	test('never asks Harbor for individual CVEs', async () => {
		await fetch(`${vitrine.url}/images`);

		expect(harbors[0].requests.filter((request) => request.includes('/additions/'))).toEqual([]);
	});
});

describe('one Harbor Source down among several', () => {
	test('limits the error to the Harbor project of that Source', async () => {
		const up = await startFakeHarbor({ projects: { platform: ['platform/api'] } });
		const down = await startFakeHarbor({ projects: { tools: ['tools/cli'] } });
		down.behave('down');
		const vitrine = await startVitrine({
			sources: [
				{ name: 'main-harbor', type: 'harbor', url: up.url, projects: ['platform'] },
				{ name: 'tools-harbor', type: 'harbor', url: down.url, projects: ['tools'] },
			],
			routes: [{ url: '/images', controller: 'harbor-images' }],
		});

		const response = await fetch(`${vitrine.url}/images`);
		const html = await response.text();

		await vitrine.stop();
		await Promise.all([up.stop(), down.stop()]);
		expect(response.status).toBe(200);
		expect(html).toContain('platform/api');
		expect(html).toContain('Images could not be loaded because tools-harbor is down.');
	});
});

describe('reading Harbor', () => {
	const route = { url: '/images', controller: 'harbor-images' };

	test('authenticates with a password from the environment', async () => {
		const harbor = await startFakeHarbor({
			projects: { platform: ['platform/private'] },
			artifacts: { 'platform/private': [artifact] },
			credentials: { username: 'robot', password: 's3cret' },
		});
		const vitrine = await startVitrine(
			{
				sources: [{ name: 'main-harbor', type: 'harbor', url: harbor.url, projects: ['platform'], username: 'robot', passwordEnv: 'HARBOR_PASSWORD' }],
				routes: [route],
			},
			{ HARBOR_PASSWORD: 's3cret' },
		);

		const html = await (await fetch(`${vitrine.url}/images`)).text();

		await vitrine.stop();
		await harbor.stop();
		expect(html).toContain('platform/private');
		expect(html).toContain('1.0');
	});

	test('shows every Image when a project spans several API pages', async () => {
		const names = Array.from({ length: 150 }, (_, index) => `platform/image-${index}`);
		const harbor = await startFakeHarbor({ projects: { platform: names } });
		const vitrine = await startVitrine({
			sources: [{ name: 'main-harbor', type: 'harbor', url: harbor.url, projects: ['platform'] }],
			routes: [route],
		});

		const html = await (await fetch(`${vitrine.url}/images`)).text();

		await vitrine.stop();
		await harbor.stop();
		expect(harbor.repositoryListRequests()).toHaveLength(2);
		expect(html).toContain('platform/image-0<');
		expect(html).toContain('platform/image-149<');
	});
});

describe('reading a Source through the cache', () => {
	const route = { url: '/images', controller: 'harbor-images' };

	async function start(source: Record<string, unknown> = {}, projects: Record<string, string[]> = { platform: ['platform/api'] }) {
		const harbor = await startFakeHarbor({ projects, artifacts: { 'platform/api': [artifact] } });
		const vitrine = await startVitrine({
			sources: [{ name: 'main-harbor', type: 'harbor', url: harbor.url, projects: Object.keys(projects), ...source }],
			routes: [route],
		});
		cleanups.push(vitrine.stop, harbor.stop);
		const images = async () => {
			const response = await fetch(`${vitrine.url}/images`);
			const page = { status: response.status, html: await response.text() };
			// Lets an allowed age of ONE_MILLISECOND run out before the next request.
			await new Promise((resolve) => setTimeout(resolve, 5));
			return page;
		};
		return { harbor, images };
	}

	const ONE_MILLISECOND = 1 / 60_000;
	const cleanups: (() => Promise<void>)[] = [];

	afterEach(async () => {
		await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
	});

	test('serves fresh data without calling the Source', async () => {
		const { harbor, images } = await start();

		await images();
		const { html } = await images();

		expect(html).toContain('platform/api');
		expect(harbor.repositoryListRequests()).toHaveLength(1);
	});

	test('caches the whole list of a Harbor project, its tags and scans included', async () => {
		const { harbor, images } = await start();

		const first = await images();
		const requestsAfterFirstLoad = harbor.requests.length;
		const second = await images();

		expect(requestsAfterFirstLoad).toBeGreaterThan(1);
		expect(harbor.requests).toHaveLength(requestsAfterFirstLoad);
		expect(second.html).toBe(first.html);
		expect(second.html).toContain('docker pull');
	});

	test('serves Stale data when only the tags of an Image cannot be loaded', async () => {
		const { harbor, images } = await start({ allowedAgeMinutes: ONE_MILLISECOND });

		await images();
		harbor.behave('down-after-repositories');
		const { html } = await images();

		expect(html).toContain('docker pull');
		expect(html).toContain('This list is Stale');
	});

	test('loads each selected Harbor project on its own', async () => {
		const { harbor, images } = await start({}, { platform: ['platform/api'], data: ['data/etl'] });

		await images();

		expect(harbor.repositoryListRequests()).toHaveLength(2);
	});

	test('loads data older than its allowed age and replaces the cached data', async () => {
		const projects = { platform: ['platform/old'] };
		const { images } = await start({ allowedAgeMinutes: ONE_MILLISECOND }, projects);

		await images();
		projects.platform = ['platform/new'];
		const { html } = await images();

		expect(html).toContain('platform/new');
		expect(html).not.toContain('platform/old');
	});

	test('serves Stale data with a warning while the Source is down', async () => {
		const { harbor, images } = await start({ allowedAgeMinutes: ONE_MILLISECOND });

		expect((await images()).html).not.toContain('This list is Stale');
		harbor.behave('down');
		const { html } = await images();

		expect(html).toContain('platform/api');
		expect(html).toContain('This list is Stale');
	});

	test('drops the warning once the Source is back', async () => {
		const { harbor, images } = await start({ allowedAgeMinutes: ONE_MILLISECOND });

		await images();
		harbor.behave('down');
		await images();
		harbor.behave('up');

		expect((await images()).html).not.toContain('This list is Stale');
	});

	test('shows an error in the section and keeps the page when nothing is cached', async () => {
		const { harbor, images } = await start();

		harbor.behave('down');
		const { status, html } = await images();

		expect(status).toBe(200);
		expect(html).toContain('<h1>Images</h1>');
		expect(html).toContain('Images could not be loaded');
	});

	test.each([
		['with the cache', {}],
		['with the cache disabled', { allowedAgeMinutes: 0 }],
	])('counts a Source that takes over 10 seconds as down %s', async (_, source) => {
		const { harbor, images } = await start(source);

		harbor.behave('hanging');
		const startedAt = Date.now();
		const { html } = await images();
		const elapsed = Date.now() - startedAt;

		expect(html).toContain('Images could not be loaded');
		expect(elapsed).toBeGreaterThanOrEqual(9_900);
		expect(elapsed).toBeLessThan(12_000);
	});

	test('serves Stale data with a warning when the Source takes over 10 seconds', async () => {
		const { harbor, images } = await start({ allowedAgeMinutes: ONE_MILLISECOND });

		await images();
		harbor.behave('hanging');
		const { html } = await images();

		expect(html).toContain('platform/api');
		expect(html).toContain('This list is Stale');
	});

	test('calls the Source on every request when the allowed age is 0', async () => {
		const { harbor, images } = await start({ allowedAgeMinutes: 0 });

		await images();
		await images();

		expect(harbor.repositoryListRequests()).toHaveLength(2);
	});

	test('never serves Stale data when the allowed age is 0', async () => {
		const { harbor, images } = await start({ allowedAgeMinutes: 0 });

		await images();
		harbor.behave('down');
		const { status, html } = await images();

		expect(status).toBe(200);
		expect(html).toContain('<h1>Images</h1>');
		expect(html).toContain('Images could not be loaded');
		expect(html).not.toContain('platform/api');
	});

	test('shares one Source call between simultaneous requests', async () => {
		const { harbor, images } = await start();

		harbor.behave('slow');
		const pages = await Promise.all([images(), images(), images(), images(), images()]);

		expect(pages.map(({ html }) => html.includes('platform/api'))).toEqual([true, true, true, true, true]);
		expect(harbor.repositoryListRequests()).toHaveLength(1);
	});

	test('shares one Source call when simultaneous requests refresh data older than its allowed age', async () => {
		const { harbor, images } = await start({ allowedAgeMinutes: ONE_MILLISECOND });

		await images();
		harbor.behave('slow');
		await Promise.all([images(), images(), images(), images(), images()]);

		expect(harbor.repositoryListRequests()).toHaveLength(2);
	});
});

describe('invalid Settings stop startup', () => {
	const source = { name: 'main-harbor', type: 'harbor', url: 'http://harbor.test', projects: ['platform'] };
	const route = { url: '/images', controller: 'harbor-images', params: { source: 'main-harbor' } };

	test.each([
		['malformed YAML', 'sources: [', 'settings.yaml'],
		['a missing section', { sources: [source] }, 'routes'],
		['an unknown section', { sources: [source], routes: [route], extra: true }, 'extra'],
		['a misspelt key', { sources: [{ ...source, passwrodEnv: 'HARBOR_PASSWORD' }], routes: [route] }, 'passwrodEnv'],
		['a password in the file', { sources: [{ ...source, password: 's3cret' }], routes: [route] }, 'password'],
		['a username with no passwordEnv', { sources: [{ ...source, username: 'robot' }], routes: [route] }, 'username and passwordEnv'],
		['a passwordEnv with no username', { sources: [{ ...source, passwordEnv: 'PATH' }], routes: [route] }, 'username and passwordEnv'],
		['a Route URL with a trailing slash', { sources: [source], routes: [{ ...route, url: '/images/' }] }, 'trailing slash'],
		['an unknown Controller parameter', { sources: [source], routes: [{ ...route, params: { ...route.params, extra: 'x' } }] }, 'extra'],
		['an empty file', '', 'the file is empty, see settings.example.yaml'],
		['an unknown Controller', { sources: [source], routes: [{ ...route, controller: 'nope' }] }, 'controller'],
		['a Route to an unknown Source', { sources: [], routes: [route] }, 'unknown Source "main-harbor"'],
		['a Source with no Harbor projects', { sources: [{ ...source, projects: [] }], routes: [route] }, 'projects'],
		['a Source without a projects key', { sources: [{ name: 'main-harbor', type: 'harbor', url: 'http://harbor.test' }], routes: [route] }, 'projects'],
		['the same Harbor project twice', { sources: [{ ...source, projects: ['platform', 'platform'] }], routes: [route] }, 'Source "main-harbor" selects Harbor project "platform" twice'],
		['the same URL twice', { sources: [source], routes: [route, route] }, 'Route "/images" is declared twice'],
		['a negative allowed age', { sources: [{ ...source, allowedAgeMinutes: -1 }], routes: [route] }, 'allowedAgeMinutes'],
		['an unset secret', { sources: [{ ...source, username: 'robot', passwordEnv: 'VITRINE_UNSET' }], routes: [route] }, 'VITRINE_UNSET'],
	])('with %s', async (_, settings, expectedError) => {
		const { exitCode, output } = await startupFailure(settings);

		expect(exitCode).toBe(1);
		expect(output).toContain(expectedError);
	});

	test('with astro dev', async () => {
		const { exitCode } = await devStartupFailure('sources: [');

		expect(exitCode).not.toBe(0);
	});

	test('because the built entry serves nothing by itself', async () => {
		const { exitCode, output } = await runBuiltEntryDirectly('sources: [');

		expect(exitCode).toBe(0);
		expect(output).not.toContain('Server listening');
	});
});

test('the example Settings file starts Vitrine', async () => {
	const vitrine = await startVitrine(readFileSync('settings.example.yaml', 'utf8'), { HARBOR_PASSWORD: 's3cret' });

	const response = await fetch(`${vitrine.url}/nowhere`);

	await vitrine.stop();
	expect(response.status).toBe(404);
});
