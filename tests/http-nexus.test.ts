import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { cacheStores } from './support/cache-stores.ts';
import { startFakeNexus } from './support/fake-nexus.ts';
import type { FakeNexus } from './support/fake-nexus.ts';
import { startupFailure, startVitrine } from './support/vitrine.ts';
import type { RunningVitrine } from './support/vitrine.ts';

const repositories = [
	{ name: 'maven-releases', format: 'maven2', type: 'hosted' },
	{ name: 'npm-proxy', format: 'npm', type: 'proxy' },
	{ name: 'docker-all', format: 'docker', type: 'group' },
];

/** What a Visitor reads, with the markup left out. */
function textOf(html: string) {
	return html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

describe.each(cacheStores)('with the $name cache store', ({ survivesRestart, empty }) => {
	describe('a Route to the nexus Controller', () => {
		let nexus: FakeNexus;
		let otherNexus: FakeNexus;
		let vitrine: RunningVitrine;

		beforeAll(async () => {
			nexus = await startFakeNexus({ repositories, credentials: { username: 'vitrine', password: 's3cret' } });
			otherNexus = await startFakeNexus({ repositories: [{ name: 'raw-files', format: 'raw', type: 'hosted' }] });
			vitrine = await startVitrine(
				{
					sources: [
						{ name: 'main-nexus', type: 'nexus', url: nexus.url, username: 'vitrine', passwordEnv: 'NEXUS_PASSWORD' },
						{ name: 'other-nexus', type: 'nexus', url: otherNexus.url, repositories: ['raw-files'] },
					],
					routes: [
						{ url: '/nexus/:source', controller: 'nexus' },
						{ url: '/search', controller: 'search' },
					],
					cacheStore: await empty(),
				},
				{ NEXUS_PASSWORD: 's3cret' },
			);
		});

		afterAll(async () => {
			await vitrine?.stop();
			await nexus?.stop();
			await otherNexus?.stop();
		});

		afterEach(() => {
			nexus.behave('up');
		});

		test('lists the Repositories of the Source with their format, type and link to Nexus', async () => {
			const response = await fetch(`${vitrine.url}/nexus/main-nexus`);

			expect(response.status).toBe(200);
			const html = await response.text();
			expect(html).toContain('<h1>main-nexus</h1>');
			expect(textOf(html)).toContain('maven-releases Format maven2 Type hosted npm-proxy Format npm Type proxy docker-all Format docker Type group');
			expect(html).toContain(`href="${nexus.url}/#browse/browse:npm-proxy"`);
		});

		test('lists the Repositories of the Source named in the URL only', async () => {
			const html = await (await fetch(`${vitrine.url}/nexus/other-nexus`)).text();

			expect(html).toContain('raw-files');
			expect(html).not.toContain('maven-releases');
		});

		test('serves the list from the cache without calling the Source again', async () => {
			await (await fetch(`${vitrine.url}/nexus/main-nexus`)).text();
			const before = nexus.requests.length;

			await (await fetch(`${vitrine.url}/nexus/main-nexus`)).text();

			expect(nexus.requests).toHaveLength(before);
		});

		test('finds Repositories by a search for maven, each leading to the list of its Source', async () => {
			const response = await fetch(`${vitrine.url}/search?q=maven`);

			expect(response.status).toBe(200);
			const html = await response.text();
			expect(textOf(html)).toContain('1 result in');
			expect(textOf(html)).toContain('Repository in main-nexus maven-releases maven2, hosted');
			expect(html).toContain('href="/nexus/main-nexus"');
			expect(html).not.toContain('raw-files');
		});

		test('returns a not-found page for an unknown Source, without asking Nexus', async () => {
			const before = nexus.requests.length;

			const response = await fetch(`${vitrine.url}/nexus/nope`);

			expect(response.status).toBe(404);
			await response.text();
			expect(nexus.requests).toHaveLength(before);
		});
	});

	describe('reading Nexus through the cache', () => {
		const ONE_MILLISECOND = 1 / 60_000;
		const cleanups: (() => Promise<unknown>)[] = [];

		afterEach(async () => {
			await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
		});

		async function start(source: Record<string, unknown> = {}) {
			const nexus = await startFakeNexus({ repositories });
			const settings = {
				sources: [{ name: 'main-nexus', type: 'nexus', url: nexus.url, ...source }],
				routes: [{ url: '/nexus/:source', controller: 'nexus' }],
				cacheStore: await empty(),
			};
			let vitrine = await startVitrine(settings);
			cleanups.push(() => vitrine.stop(), nexus.stop);
			const page = async () => {
				const response = await fetch(`${vitrine.url}/nexus/main-nexus`);
				const result = { status: response.status, html: await response.text() };
				// Lets an allowed age of ONE_MILLISECOND run out before the next request.
				await new Promise((resolve) => setTimeout(resolve, 5));
				return result;
			};
			const restart = async () => {
				await vitrine.stop();
				vitrine = await startVitrine(settings);
			};
			return { nexus, page, restart };
		}

		test('serves Stale Repositories with a warning while the Source is down', async () => {
			const { nexus, page } = await start({ allowedAgeMinutes: ONE_MILLISECOND });

			expect((await page()).html).not.toContain('This list is Stale');
			nexus.behave('down');
			const { html } = await page();

			expect(html).toContain('maven-releases');
			expect(html).toContain('This list is Stale because main-nexus is down.');
		});

		test('shows an error in the section and keeps the page when nothing is cached', async () => {
			const { nexus, page } = await start();

			nexus.behave('down');
			const { status, html } = await page();

			expect(status).toBe(200);
			expect(html).toContain('<h1>main-nexus</h1>');
			expect(html).toContain('Repositories could not be loaded because main-nexus is down.');
		});

		test(`${survivesRestart ? 'keeps' : 'loses'} cached Repositories across a restart`, async () => {
			const { nexus, page, restart } = await start();

			await page();
			await restart();
			const { html } = await page();

			expect(html).toContain('maven-releases');
			expect(nexus.requests).toHaveLength(survivesRestart ? 1 : 2);
		});
	});
});

describe('invalid Nexus Settings stop startup', () => {
	const source = { name: 'main-nexus', type: 'nexus', url: 'http://nexus.test' };
	const route = { url: '/nexus/:source', controller: 'nexus' };

	test.each([
		['a Source with no url', { sources: [{ name: 'main-nexus', type: 'nexus' }], routes: [route] }, 'url'],
		['a password in the file', { sources: [{ ...source, password: 's3cret' }], routes: [route] }, 'password'],
		['a username with no passwordEnv', { sources: [{ ...source, username: 'vitrine' }], routes: [route] }, 'username and passwordEnv'],
		['an unset secret', { sources: [{ ...source, username: 'vitrine', passwordEnv: 'VITRINE_UNSET' }], routes: [route] }, 'VITRINE_UNSET'],
		['an empty selection of Repositories', { sources: [{ ...source, repositories: [] }], routes: [route] }, 'repositories'],
		['the same Repository twice', { sources: [{ ...source, repositories: ['npm', 'npm'] }], routes: [route] }, 'Source "main-nexus" selects Repository "npm" twice'],
		['a negative allowed age', { sources: [{ ...source, allowedAgeMinutes: -1 }], routes: [route] }, 'allowedAgeMinutes'],
		['a nexus Route with no Source', { sources: [source], routes: [{ url: '/nexus', controller: 'nexus' }] }, 'source'],
		['a nexus Route to a Source of another type', { sources: [{ name: 'main-harbor', type: 'harbor', url: 'http://harbor.test', projects: ['p'] }], routes: [{ ...route, url: '/nexus', params: { source: 'main-harbor' } }] }, 'unknown Source "main-harbor"'],
	])('with %s', async (_, settings, expectedError) => {
		const { exitCode, problems } = await startupFailure(settings);

		expect(exitCode).toBe(1);
		expect(problems).toContainEqual(expect.stringContaining(expectedError));
	});

	test('accepts several Nexus Sources', async () => {
		const vitrine = await startVitrine({ sources: [source, { ...source, name: 'other-nexus' }], routes: [route] });

		expect(await vitrine.stop()).toBe(0);
	});
});
