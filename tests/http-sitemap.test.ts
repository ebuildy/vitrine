import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { cacheStores } from './support/cache-stores.ts';
import { startFakeNexus } from './support/fake-nexus.ts';
import type { FakeNexus } from './support/fake-nexus.ts';
import { startupFailure, startVitrine } from './support/vitrine.ts';
import type { RunningVitrine } from './support/vitrine.ts';

/** Each <url> of a sitemap, as its <loc> and <lastmod>. */
function entriesOf(xml: string) {
	return [...xml.matchAll(/<url><loc>([^<]*)<\/loc><lastmod>([^<]*)<\/lastmod><\/url>/g)].map(([, loc, lastmod]) => ({ loc, lastmod }));
}

describe.each(cacheStores)('with the $name cache store', ({ survivesRestart, empty }) => {
	describe('/sitemap.xml', () => {
		let nexus: FakeNexus;
		let vitrine: RunningVitrine;
		let settings: unknown;

		beforeAll(async () => {
			nexus = await startFakeNexus({ repositories: [{ name: 'maven-releases', format: 'maven2', type: 'hosted' }] });
			settings = {
				sources: [{ name: 'main-nexus', type: 'nexus', url: nexus.url }],
				routes: [
					{ url: '/nexus/:source', controller: 'nexus' },
					{ url: '/search', controller: 'search' },
				],
				cacheStore: await empty(),
			};
			vitrine = await startVitrine(settings);
		});

		afterAll(async () => {
			await vitrine?.stop();
			await nexus?.stop();
		});

		test('is an empty sitemap before anyone visits a page', async () => {
			const response = await fetch(`${vitrine.url}/sitemap.xml`);

			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toMatch(/^application\/xml/);
			const xml = await response.text();
			expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
			expect(xml).toMatch(/<\/urlset>\n?$/);
			expect(entriesOf(xml)).toEqual([]);
		});

		test('lists each page visited with status 200, once, with the time of its last visit and without its query', async () => {
			const before = Date.now();
			await (await fetch(`${vitrine.url}/nexus/main-nexus`)).text();
			await (await fetch(`${vitrine.url}/search?q=maven`)).text();
			await (await fetch(`${vitrine.url}/nexus/main-nexus`)).text();
			await (await fetch(`${vitrine.url}/nexus/nope`)).text();
			await (await fetch(`${vitrine.url}/nowhere`)).text();
			const after = Date.now();

			const entries = entriesOf(await (await fetch(`${vitrine.url}/sitemap.xml`)).text());

			expect(entries.map(({ loc }) => loc).sort()).toEqual([`${vitrine.url}/nexus/main-nexus`, `${vitrine.url}/search`]);
			for (const { lastmod } of entries) {
				expect(lastmod).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/);
				expect(Date.parse(lastmod)).toBeGreaterThanOrEqual(before - 1000);
				expect(Date.parse(lastmod)).toBeLessThanOrEqual(after + 1000);
			}
		});

		test('gives https addresses behind a proxy that ends TLS', async () => {
			await (await fetch(`${vitrine.url}/nexus/main-nexus`)).text();

			const xml = await (await fetch(`${vitrine.url}/sitemap.xml`, { headers: { 'x-forwarded-proto': 'https' } })).text();

			expect(entriesOf(xml).map(({ loc }) => loc)).toContain(`${vitrine.url.replace('http:', 'https:')}/nexus/main-nexus`);
		});

		test(`${survivesRestart ? 'keeps' : 'loses'} the pages visited across a restart`, async () => {
			await (await fetch(`${vitrine.url}/nexus/main-nexus`)).text();
			await vitrine.stop();
			vitrine = await startVitrine(settings);

			const entries = entriesOf(await (await fetch(`${vitrine.url}/sitemap.xml`)).text());

			expect(entries.map(({ loc }) => loc)).toEqual(survivesRestart ? expect.arrayContaining([`${vitrine.url}/nexus/main-nexus`]) : []);
		});

		test('leaves out a page once it is not found', async () => {
			await (await fetch(`${vitrine.url}/nexus/main-nexus`)).text();
			await vitrine.stop();
			// The same store, with the Source gone from Settings, so its page is not found.
			vitrine = await startVitrine({ ...(settings as object), sources: [{ name: 'other-nexus', type: 'nexus', url: nexus.url }] });

			expect((await fetch(`${vitrine.url}/nexus/main-nexus`)).status).toBe(404);
			const xml = await (await fetch(`${vitrine.url}/sitemap.xml`)).text();

			expect(xml).not.toContain('/nexus/main-nexus');
			await vitrine.stop();
			vitrine = await startVitrine(settings);
		});
	});
});

describe('a Route at /sitemap.xml', () => {
	test('stops startup, as Vitrine serves that URL itself', async () => {
		const { exitCode, problems } = await startupFailure({ sources: [], routes: [{ url: '/sitemap.xml', controller: 'search' }] });

		expect(exitCode).toBe(1);
		expect(problems).toContainEqual(expect.stringContaining('Route "/sitemap.xml": Vitrine serves this URL itself'));
	});
});
