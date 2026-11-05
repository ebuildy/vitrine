import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { cacheStores } from './support/cache-stores.ts';
import { startFakeNexus } from './support/fake-nexus.ts';
import type { FakeNexus } from './support/fake-nexus.ts';
import { startupFailure, startVitrine } from './support/vitrine.ts';
import type { RunningVitrine } from './support/vitrine.ts';

const repositories = [{ name: 'maven-releases', format: 'maven2', type: 'hosted' }];

async function scrape(vitrine: RunningVitrine, headers: Record<string, string> = {}) {
	const response = await fetch(`${vitrine.url}/metrics`, { headers });
	return { response, text: await response.text() };
}

/** The value of the sample whose name and labels the line starts with. */
function sample(text: string, series: string): number | undefined {
	const line = text.split('\n').find((candidate) => candidate.startsWith(`${series} `));
	return line === undefined ? undefined : Number(line.slice(series.length + 1));
}

function settingsFor(nexus: FakeNexus, cacheStore: unknown, extra: Record<string, unknown> = {}) {
	return {
		sources: [{ name: 'main-nexus', type: 'nexus', url: nexus.url }],
		routes: [{ url: '/nexus/:source', controller: 'nexus' }],
		cacheStore,
		...extra,
	};
}

describe.each(cacheStores)('/metrics with the $name cache store', ({ name, empty }) => {
	let nexus: FakeNexus;
	let vitrine: RunningVitrine;
	let store: string;

	beforeAll(async () => {
		nexus = await startFakeNexus({ repositories });
		const cacheStore = await empty();
		store = cacheStore.type as string;
		vitrine = await startVitrine(settingsFor(nexus, cacheStore));
		await (await fetch(`${vitrine.url}/nexus/main-nexus`)).text();
		await (await fetch(`${vitrine.url}/nexus/main-nexus`)).text();
	});

	afterAll(async () => {
		await vitrine?.stop();
		await nexus?.stop();
	});

	test(`counts the entries and bytes of the ${name} store, and its hits and misses`, async () => {
		const { response, text } = await scrape(vitrine);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toMatch(/^text\/plain/);
		// Every entry was missed once before it was written, and the second visit read them all.
		const misses = sample(text, `vitrine_cache_misses_total{store="${store}"}`);
		expect(misses).toBeGreaterThanOrEqual(1);
		expect(sample(text, `vitrine_cache_entries{store="${store}"}`)).toBeGreaterThanOrEqual(1);
		// Redis reports no size, which would take a command per key.
		if (store === 'redis') expect(sample(text, `vitrine_cache_bytes{store="redis"}`)).toBeUndefined();
		else expect(sample(text, `vitrine_cache_bytes{store="${store}"}`)).toBeGreaterThan(0);
		expect(sample(text, `vitrine_cache_hits_total{store="${store}"}`)).toBeGreaterThanOrEqual(1);
	});
});

describe('/metrics', () => {
	const cleanups: (() => Promise<unknown>)[] = [];

	async function start(extra: Record<string, unknown> = {}, env: Record<string, string> = {}) {
		const nexus = await startFakeNexus({ repositories });
		const vitrine = await startVitrine(settingsFor(nexus, { type: 'memory' }, extra), env);
		cleanups.push(() => vitrine.stop(), nexus.stop);
		return { nexus, vitrine };
	}

	afterAll(async () => {
		await Promise.all(cleanups.map((cleanup) => cleanup()));
	});

	test('counts and times the calls to a Source, and the render of a Route', async () => {
		const { vitrine } = await start();
		await (await fetch(`${vitrine.url}/nexus/main-nexus`)).text();

		const { text } = await scrape(vitrine);

		expect(sample(text, 'vitrine_source_http_calls_total{source="nexus",method="GET",outcome="2xx"}')).toBe(1);
		expect(sample(text, 'vitrine_source_http_call_duration_seconds_count{source="nexus",method="GET",outcome="2xx"}')).toBe(1);
		expect(sample(text, 'vitrine_render_duration_seconds_count{route="/nexus/:source"}')).toBe(1);
		expect(text).toContain('process_cpu_user_seconds_total');
	});

	test('counts a Source that answers an error or does not answer', async () => {
		const { vitrine, nexus } = await start();
		nexus.behave('down');
		await (await fetch(`${vitrine.url}/nexus/main-nexus`)).text();

		const { text } = await scrape(vitrine);

		expect(sample(text, 'vitrine_source_http_calls_total{source="nexus",method="GET",outcome="5xx"}')).toBe(1);
	});

	test('counts the warm-ups of the server, their URLs and the pages with problems', async () => {
		const nexus = await startFakeNexus({ repositories });
		cleanups.push(nexus.stop);
		const vitrine = await startVitrine(settingsFor(nexus, { type: 'memory' }, { warmUp: { atStart: true }, navigation: [{ label: 'Nexus', url: '/nexus/main-nexus' }] }));
		cleanups.push(() => vitrine.stop());
		let text = '';
		for (let attempt = 0; attempt < 100 && sample(text, 'vitrine_warmup_runs_total') !== 1; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 50));
			text = (await scrape(vitrine)).text;
		}

		expect(sample(text, 'vitrine_warmup_runs_total')).toBe(1);
		expect(sample(text, 'vitrine_warmup_duration_seconds_count')).toBe(1);
		expect(sample(text, 'vitrine_warmup_urls_found_total')).toBeGreaterThanOrEqual(1);
		expect(sample(text, 'vitrine_warmup_pages_with_problems_total')).toBe(0);
	});

	test('is open without METRICS_TOKEN', async () => {
		const { vitrine } = await start();

		expect((await scrape(vitrine)).response.status).toBe(200);
	});

	test('answers 401 without the right bearer token, and 200 with it', async () => {
		const { vitrine } = await start({}, { METRICS_TOKEN: 's3cret' });

		const missing = await scrape(vitrine);
		const wrong = await scrape(vitrine, { authorization: 'Bearer nope' });
		const right = await scrape(vitrine, { authorization: 'Bearer s3cret' });

		expect(missing.response.status).toBe(401);
		expect(missing.response.headers.get('www-authenticate')).toBe('Bearer');
		expect(wrong.response.status).toBe(401);
		expect(right.response.status).toBe(200);
	});

	test('stops startup on a Route at /metrics, as Vitrine serves that URL itself', async () => {
		const { exitCode, output } = await startupFailure({ sources: [], routes: [{ url: '/metrics', controller: 'search' }] });

		expect(exitCode).toBe(1);
		expect(output).toContain('Route "/metrics": Vitrine serves this URL itself');
	});

	test('serves a Route at /metrics instead, with metrics.enabled: false', async () => {
		const nexus = await startFakeNexus({ repositories });
		cleanups.push(nexus.stop);
		const vitrine = await startVitrine(settingsFor(nexus, { type: 'memory' }, { routes: [{ url: '/metrics', controller: 'search' }], metrics: { enabled: false } }));
		cleanups.push(() => vitrine.stop());

		const { response, text } = await scrape(vitrine);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toMatch(/^text\/html/);
		expect(text).not.toContain('vitrine_cache_hits_total');
	});

	test('serves the metrics at metrics.path instead of /metrics', async () => {
		const { vitrine } = await start({ metrics: { path: '/stats/prometheus' } });

		const moved = await fetch(`${vitrine.url}/stats/prometheus`);
		const old = await fetch(`${vitrine.url}/metrics`);

		expect(moved.status).toBe(200);
		expect(await moved.text()).toContain('vitrine_cache_');
		expect(old.status).toBe(404);
	});

	test('stops startup on a Route at metrics.path, and no more at /metrics', async () => {
		const reserved = await startupFailure({ sources: [], routes: [{ url: '/stats', controller: 'search' }], metrics: { path: '/stats' } });

		expect(reserved.exitCode).toBe(1);
		expect(reserved.output).toContain('Route "/stats": Vitrine serves this URL itself');
	});

	test('serves a Route at /metrics when metrics.path moved', async () => {
		const nexus = await startFakeNexus({ repositories });
		cleanups.push(nexus.stop);
		const vitrine = await startVitrine(settingsFor(nexus, { type: 'memory' }, { routes: [{ url: '/metrics', controller: 'search' }], metrics: { path: '/stats' } }));
		cleanups.push(() => vitrine.stop());

		const { response } = await scrape(vitrine);

		expect(response.headers.get('content-type')).toMatch(/^text\/html/);
	});

	test.each(['metrics', '/', '/sitemap.xml', '/a?b', '/a b'])('stops startup on the invalid metrics.path %j', async (path) => {
		const { exitCode, output } = await startupFailure({ sources: [], routes: [], metrics: { path } });

		expect(exitCode).toBe(1);
		expect(output).toContain('metrics.path');
	});

	test('is not served with metrics.enabled: false', async () => {
		const { vitrine } = await start({ metrics: { enabled: false } });

		expect((await scrape(vitrine)).response.status).toBe(404);
	});

	test('uses the buckets of METRICS_BUCKETS', async () => {
		const { vitrine } = await start({}, { METRICS_BUCKETS: '0.25, 2' });
		await (await fetch(`${vitrine.url}/nexus/main-nexus`)).text();

		const { text } = await scrape(vitrine);

		expect(sample(text, 'vitrine_render_duration_seconds_bucket{le="0.25",route="/nexus/:source"}')).toBeDefined();
		expect(sample(text, 'vitrine_render_duration_seconds_bucket{le="2",route="/nexus/:source"}')).toBeDefined();
		expect(text).not.toContain('le="30"');
	});

	test('stops startup on an invalid METRICS_BUCKETS', async () => {
		const nexus = await startFakeNexus({ repositories });
		cleanups.push(nexus.stop);

		const { exitCode, output } = await startupFailure(settingsFor(nexus, { type: 'memory' }), { METRICS_BUCKETS: '5,1' });

		expect(exitCode).toBe(1);
		expect(output).toContain('Invalid METRICS_BUCKETS "5,1"');
	});
});
