import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { startFakeNexus } from './support/fake-nexus.ts';
import type { FakeNexusOptions } from './support/fake-nexus.ts';
import { freePort } from './support/free-port.ts';
import { cacheStores } from './support/cache-stores.ts';
import { startVitrine } from './support/vitrine.ts';
import type { RunningVitrine } from './support/vitrine.ts';

const repositories = [{ name: 'maven-releases', format: 'maven2', type: 'hosted' }];
const NEXUS_CALLS = (outcome: string) => `vitrine_source_http_calls_total{source="nexus",method="GET",outcome="${outcome}"}`;

/** Every sample of a scrape, by its name and labels as written. */
function samples(text: string): Map<string, number> {
	const result = new Map<string, number>();
	for (const line of text.split('\n')) {
		const match = /^([^#\s].*?) (-?[\d.e+-]+|NaN|\+Inf)$/.exec(line);
		if (match) result.set(match[1], Number(match[2]));
	}
	return result;
}

describe('the values of /metrics', () => {
	const cleanups: (() => Promise<unknown>)[] = [];

	afterEach(async () => {
		await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
	});

	async function start(nexusOptions: Partial<FakeNexusOptions> = {}, extra: Record<string, unknown> = {}, source: Record<string, unknown> = {}) {
		const nexus = await startFakeNexus({ repositories, ...nexusOptions });
		const vitrine = await startVitrine({
			sources: [{ name: 'main-nexus', type: 'nexus', url: nexus.url, ...source }],
			routes: [
				{ url: '/nexus/:source', controller: 'nexus' },
				{ url: '/search', controller: 'search' },
			],
			cacheStore: { type: 'memory' },
			...extra,
		});
		cleanups.push(() => vitrine.stop(), nexus.stop);
		const visit = async (path: string) => (await fetch(`${vitrine.url}${path}`)).text();
		const scrape = async () => samples(await (await fetch(`${vitrine.url}/metrics`)).text());
		return { nexus, vitrine, visit, scrape };
	}

	test('count exactly the calls a Source received, and none for a page served from the cache', async () => {
		const { nexus, visit, scrape } = await start();

		await visit('/nexus/main-nexus');
		const afterFirst = await scrape();
		await visit('/nexus/main-nexus');
		await visit('/nexus/main-nexus');
		const afterThree = await scrape();

		expect(nexus.requests.length).toBeGreaterThan(0);
		expect(afterFirst.get(NEXUS_CALLS('2xx'))).toBe(nexus.requests.length);
		expect(afterThree.get(NEXUS_CALLS('2xx'))).toBe(nexus.requests.length);
		expect(afterThree.get(`vitrine_source_http_call_duration_seconds_count{source="nexus",method="GET",outcome="2xx"}`)).toBe(nexus.requests.length);
	});

	test('count a read of a Source as a miss the first time and a hit after, by Source', async () => {
		const { visit, scrape } = await start();

		await visit('/nexus/main-nexus');
		const first = await scrape();
		await visit('/nexus/main-nexus');
		await visit('/nexus/main-nexus');
		const third = await scrape();

		const hit = 'vitrine_source_cache_lookups_total{source="nexus",status="hit"}';
		const miss = 'vitrine_source_cache_lookups_total{source="nexus",status="miss"}';
		// The page reads the repositories once per visit.
		expect(first.get(miss)).toBe(1);
		expect(first.has(hit)).toBe(false);
		expect(third.get(miss)).toBe(1);
		expect(third.get(hit)).toBe(2);
	});

	test('count every read as a miss when the Source is not cached', async () => {
		const { visit, scrape } = await start({}, {}, { allowedAgeMinutes: 0 });

		await visit('/nexus/main-nexus');
		await visit('/nexus/main-nexus');

		const metrics = await scrape();
		expect(metrics.get('vitrine_source_cache_lookups_total{source="nexus",status="miss"}')).toBe(2);
		expect(metrics.has('vitrine_source_cache_lookups_total{source="nexus",status="hit"}')).toBe(false);
	});

	test('count every call again when the Source is not cached', async () => {
		const { nexus, visit, scrape } = await start({}, {}, { allowedAgeMinutes: 0 });

		await visit('/nexus/main-nexus');
		await visit('/nexus/main-nexus');

		const metrics = await scrape();
		expect(nexus.requests.length).toBeGreaterThanOrEqual(2);
		expect(metrics.get(NEXUS_CALLS('2xx'))).toBe(nexus.requests.length);
	});

	test('give a histogram a sum above zero, and a +Inf bucket equal to its count', async () => {
		const { visit, scrape } = await start();
		await visit('/nexus/main-nexus');

		const metrics = await scrape();

		const labels = 'source="nexus",method="GET",outcome="2xx"';
		const count = metrics.get(`vitrine_source_http_call_duration_seconds_count{${labels}}`)!;
		expect(count).toBeGreaterThan(0);
		expect(metrics.get(`vitrine_source_http_call_duration_seconds_sum{${labels}}`)).toBeGreaterThan(0);
		expect(metrics.get(`vitrine_source_http_call_duration_seconds_bucket{le="+Inf",${labels}}`)).toBe(count);
		// A local call is well under the first default bucket, 0.1 s.
		expect(metrics.get(`vitrine_source_http_call_duration_seconds_bucket{le="0.1",${labels}}`)).toBe(count);
	});

	test('put the default buckets on every histogram', async () => {
		const { visit, scrape } = await start();
		await visit('/nexus/main-nexus');

		const metrics = await scrape();

		for (const le of ['0.1', '0.5', '1', '5', '10', '30', '+Inf']) {
			expect(metrics.has(`vitrine_render_duration_seconds_bucket{le="${le}",route="/nexus/:source"}`)).toBe(true);
			expect(metrics.has(`vitrine_warmup_duration_seconds_bucket{le="${le}"}`)).toBe(true);
		}
	});

	test('count a refused call by its status class, with its method', async () => {
		const { visit, scrape } = await start({ credentials: { username: 'reader', password: 'secret' } });
		await visit('/nexus/main-nexus');

		const metrics = await scrape();

		expect(metrics.get(NEXUS_CALLS('4xx'))).toBeGreaterThan(0);
		expect(metrics.has(NEXUS_CALLS('2xx'))).toBe(false);
	});

	test('count a call that gets no answer as an error', async () => {
		const closed = await freePort();
		const vitrine = await startVitrine({
			sources: [{ name: 'main-nexus', type: 'nexus', url: `http://127.0.0.1:${closed}` }],
			routes: [{ url: '/nexus/:source', controller: 'nexus' }],
		});
		cleanups.push(() => vitrine.stop());
		await (await fetch(`${vitrine.url}/nexus/main-nexus`)).text();

		const metrics = samples(await (await fetch(`${vitrine.url}/metrics`)).text());

		expect(metrics.get(NEXUS_CALLS('error'))).toBeGreaterThan(0);
	});

	test('count one render per visit of a Route, by its template and not by the URL', async () => {
		const { visit, scrape } = await start();

		await visit('/nexus/main-nexus');
		await visit('/nexus/main-nexus');
		await visit('/search');
		await visit('/nexus/other');

		const metrics = await scrape();
		expect(metrics.get('vitrine_render_duration_seconds_count{route="/search"}')).toBe(1);
		// "other" is not a Source, so its page is not found and is not a render of the Route.
		expect(metrics.get('vitrine_render_duration_seconds_count{route="/nexus/:source"}')).toBeGreaterThanOrEqual(2);
		expect([...metrics.keys()].some((key) => key.includes('main-nexus') && key.startsWith('vitrine_render'))).toBe(false);
	});

	test('count the warm-up runs, URLs and pages with problems of a Source that is down', async () => {
		const nexus = await startFakeNexus({ repositories });
		nexus.behave('down');
		cleanups.push(nexus.stop);
		const vitrine = await startVitrine({
			sources: [{ name: 'main-nexus', type: 'nexus', url: nexus.url }],
			routes: [{ url: '/nexus/:source', controller: 'nexus' }],
			navigation: [{ label: 'Repositories', url: '/nexus/main-nexus' }],
			warmUp: { atStart: true },
		});
		cleanups.push(() => vitrine.stop());
		let metrics = new Map<string, number>();
		for (let attempt = 0; attempt < 100 && metrics.get('vitrine_warmup_runs_total') !== 1; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 50));
			metrics = samples(await (await fetch(`${vitrine.url}/metrics`)).text());
		}

		expect(metrics.get('vitrine_warmup_runs_total')).toBe(1);
		expect(metrics.get('vitrine_warmup_duration_seconds_count')).toBe(1);
		expect(metrics.get('vitrine_warmup_urls_found_total')).toBe(1);
		expect(metrics.get('vitrine_warmup_pages_with_problems_total')).toBe(1);
	});
});

describe.each(cacheStores)('the cache values with the $name store', ({ empty }) => {
	let vitrine: RunningVitrine;
	let nexusStop: () => Promise<void>;

	afterEach(async () => {
		await vitrine?.stop();
		await nexusStop?.();
	});

	test('start at zero entries, then follow what is written', async () => {
		const nexus = await startFakeNexus({ repositories });
		nexusStop = nexus.stop;
		const cacheStore = await empty();
		const store = cacheStore.type as string;
		vitrine = await startVitrine({
			sources: [{ name: 'main-nexus', type: 'nexus', url: nexus.url }],
			routes: [{ url: '/nexus/:source', controller: 'nexus' }],
			cacheStore,
		});
		const scrape = async () => samples(await (await fetch(`${vitrine.url}/metrics`)).text());

		const empty0 = await scrape();
		expect(empty0.get(`vitrine_cache_entries{store="${store}"}`)).toBe(0);
		expect(empty0.get(`vitrine_cache_bytes{store="${store}"}`)).toBe(0);

		await (await fetch(`${vitrine.url}/nexus/main-nexus`)).text();
		const filled = await scrape();
		const entries = filled.get(`vitrine_cache_entries{store="${store}"}`)!;
		expect(entries).toBeGreaterThanOrEqual(1);
		expect(filled.get(`vitrine_cache_bytes{store="${store}"}`)).toBeGreaterThan(entries);
		const hitsBefore = filled.get(`vitrine_cache_hits_total{store="${store}"}`) ?? 0;
		const missesBefore = filled.get(`vitrine_cache_misses_total{store="${store}"}`)!;
		expect(missesBefore).toBeGreaterThanOrEqual(entries);

		await (await fetch(`${vitrine.url}/nexus/main-nexus`)).text();
		const again = await scrape();
		expect(again.get(`vitrine_cache_hits_total{store="${store}"}`)).toBeGreaterThan(hitsBefore);
		expect(again.get(`vitrine_cache_misses_total{store="${store}"}`)).toBe(missesBefore);
		expect(again.get(`vitrine_cache_entries{store="${store}"}`)).toBe(entries);
		expect(again.get(`vitrine_cache_write_errors_total{store="${store}"}`) ?? 0).toBe(0);

		// Only the files store can be checked against the disk.
		if (cacheStore.type === 'files') {
			const directory = cacheStore.directory as string;
			const files = readdirSync(directory).filter((name) => name.endsWith('.json'));
			expect(entries).toBe(files.length);
			expect(again.get(`vitrine_cache_bytes{store="files"}`)).toBe(files.reduce((total, name) => total + statSync(join(directory, name)).size, 0));
		}
	});
});
