import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { cacheStores } from './support/cache-stores.ts';
import { startFakeHarbor } from './support/fake-harbor.ts';
import type { FakeHarbor } from './support/fake-harbor.ts';
import { devStartupFailure, runBuiltEntryDirectly, startupFailure, startVitrine, writeSettings } from './support/vitrine.ts';
import type { RunningVitrine } from './support/vitrine.ts';

describe.each(cacheStores)('with the $name cache store', ({ survivesRestart, empty }) => {
	describe('a Route to the harbor-images Controller', () => {
		let harbor: FakeHarbor;
		let vitrine: RunningVitrine;

		beforeAll(async () => {
			harbor = await startFakeHarbor({ projects: { platform: ['platform/api', 'platform/worker'] } });
			vitrine = await startVitrine({
				sources: [{ name: 'main-harbor', type: 'harbor', url: harbor.url }],
				routes: [
					{ url: '/images', controller: 'harbor-images', params: { source: 'main-harbor', project: 'platform' } },
					{ url: '/', controller: 'harbor-images', params: { source: 'main-harbor', project: 'platform' } },
					{ url: '/fork-page', controller: 'harbor-images', params: { source: 'main-harbor', project: 'platform' } },
				],
				cacheStore: await empty(),
			});
		});

		afterAll(async () => {
			await vitrine?.stop();
			await harbor?.stop();
		});

		test('shows the Images of the configured Harbor project', async () => {
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

	describe('reading Harbor', () => {
		const route = { url: '/images', controller: 'harbor-images', params: { source: 'main-harbor', project: 'platform' } };

		test('authenticates with a password from the environment', async () => {
			const harbor = await startFakeHarbor({
				projects: { platform: ['platform/private'] },
				credentials: { username: 'robot', password: 's3cret' },
			});
			const vitrine = await startVitrine(
				{
					sources: [{ name: 'main-harbor', type: 'harbor', url: harbor.url, username: 'robot', passwordEnv: 'HARBOR_PASSWORD' }],
					routes: [route],
					cacheStore: await empty(),
				},
				{ HARBOR_PASSWORD: 's3cret' },
			);

			const html = await (await fetch(`${vitrine.url}/images`)).text();

			await vitrine.stop();
			await harbor.stop();
			expect(html).toContain('platform/private');
		});

		test('shows every Image when a project spans several API pages', async () => {
			const names = Array.from({ length: 150 }, (_, index) => `platform/image-${index}`);
			const harbor = await startFakeHarbor({ projects: { platform: names } });
			const vitrine = await startVitrine({
				sources: [{ name: 'main-harbor', type: 'harbor', url: harbor.url }],
				routes: [route],
				cacheStore: await empty(),
			});

			const html = await (await fetch(`${vitrine.url}/images`)).text();

			await vitrine.stop();
			await harbor.stop();
			expect(harbor.requests).toHaveLength(2);
			expect(html).toContain('platform/image-0<');
			expect(html).toContain('platform/image-149<');
		});
	});

	describe('reading a Source through the cache', () => {
		const route = { url: '/images', controller: 'harbor-images', params: { source: 'main-harbor', project: 'platform' } };

		async function start(source: Record<string, unknown> = {}, projects = { platform: ['platform/api'] }) {
			const harbor = await startFakeHarbor({ projects });
			const vitrine = await startVitrine({
				sources: [{ name: 'main-harbor', type: 'harbor', url: harbor.url, ...source }],
				routes: [route],
				cacheStore: await empty(),
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
			expect(harbor.requests).toHaveLength(1);
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

			expect(harbor.requests).toHaveLength(2);
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
			expect(harbor.requests).toHaveLength(1);
		});

		test('shares one Source call when simultaneous requests refresh data older than its allowed age', async () => {
			const { harbor, images } = await start({ allowedAgeMinutes: ONE_MILLISECOND });

			await images();
			harbor.behave('slow');
			await Promise.all([images(), images(), images(), images(), images()]);

			expect(harbor.requests).toHaveLength(2);
		});
	});

	describe('restarting Vitrine', () => {
		const route = { url: '/images', controller: 'harbor-images', params: { source: 'main-harbor', project: 'platform' } };

		test(`${survivesRestart ? 'keeps' : 'loses'} cached data across a restart`, async () => {
			const harbor = await startFakeHarbor({ projects: { platform: ['platform/api'] } });
			const settings = {
				sources: [{ name: 'main-harbor', type: 'harbor', url: harbor.url }],
				routes: [route],
				cacheStore: await empty(),
			};

			const before = await startVitrine(settings);
			await (await fetch(`${before.url}/images`)).text();
			await before.stop();
			const after = await startVitrine(settings);
			const html = await (await fetch(`${after.url}/images`)).text();

			await after.stop();
			await harbor.stop();
			expect(html).toContain('platform/api');
			expect(harbor.requests).toHaveLength(survivesRestart ? 1 : 2);
		});
	});
});

describe('a failing cache store', () => {
	const route = { url: '/images', controller: 'harbor-images', params: { source: 'main-harbor', project: 'platform' } };

	test.each([
		['local files in a directory that cannot exist', async () => ({ type: 'files', directory: join(writeSettings(''), 'cache') })],
		['a Redis nobody listens on', async () => ({ type: 'redis', urlEnv: 'VITRINE_DOWN_REDIS_URL' })],
		['a Redis that never answers', async () => ({ type: 'redis', urlEnv: 'VITRINE_SILENT_REDIS_URL' })],
	])('counts as empty with %s', async (_, cacheStore) => {
		const silentRedis = createServer();
		await new Promise<void>((resolve) => silentRedis.listen(0, '127.0.0.1', resolve));
		const { port } = silentRedis.address() as AddressInfo;
		const harbor = await startFakeHarbor({ projects: { platform: ['platform/api'] } });
		const vitrine = await startVitrine(
			{ sources: [{ name: 'main-harbor', type: 'harbor', url: harbor.url }], routes: [route], cacheStore: await cacheStore() },
			{ VITRINE_DOWN_REDIS_URL: 'redis://127.0.0.1:1', VITRINE_SILENT_REDIS_URL: `redis://127.0.0.1:${port}` },
		);

		const images = async () => {
			const startedAt = Date.now();
			const response = await fetch(`${vitrine.url}/images`);
			return { status: response.status, html: await response.text(), elapsed: Date.now() - startedAt };
		};
		const first = await images();
		const second = await images();
		const stderr = vitrine.stderr();

		await vitrine.stop();
		await harbor.stop();
		silentRedis.close();
		for (const { status, html, elapsed } of [first, second]) {
			expect(status).toBe(200);
			expect(html).toContain('platform/api');
			expect(elapsed).toBeLessThan(5_000);
		}
		expect(harbor.requests).toHaveLength(2);
		expect(stderr).toContain('Cache store');
	});
});

describe('invalid Settings stop startup', () => {
	const source = { name: 'main-harbor', type: 'harbor', url: 'http://harbor.test' };
	const route = { url: '/images', controller: 'harbor-images', params: { source: 'main-harbor', project: 'platform' } };

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
		['a missing Controller parameter', { sources: [source], routes: [{ ...route, params: { source: 'main-harbor' } }] }, 'project'],
		['the same URL twice', { sources: [source], routes: [route, route] }, 'Route "/images" is declared twice'],
		['a negative allowed age', { sources: [{ ...source, allowedAgeMinutes: -1 }], routes: [route] }, 'allowedAgeMinutes'],
		['an unknown cache store', { sources: [], routes: [], cacheStore: { type: 'nope' } }, 'cacheStore.type'],
		['a files cache store with no directory', { sources: [], routes: [], cacheStore: { type: 'files' } }, 'cacheStore.directory'],
		['a Redis cache store with no urlEnv', { sources: [], routes: [], cacheStore: { type: 'redis' } }, 'cacheStore.urlEnv'],
		['a Redis URL in the file', { sources: [], routes: [], cacheStore: { type: 'redis', urlEnv: 'PATH', url: 'redis://x' } }, 'url'],
		['an unset Redis URL', { sources: [], routes: [], cacheStore: { type: 'redis', urlEnv: 'VITRINE_UNSET' } }, 'VITRINE_UNSET'],
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
