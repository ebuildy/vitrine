import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from '@prometheus-io/client';

export const DEFAULT_BUCKETS = [0.1, 0.5, 1, 5, 10, 30];

/** The cache store the content cache reads and writes, which every cache metric is labelled with. */
export type CacheStoreType = 'memory' | 'files' | 'redis';
export type SourceType = 'gitlab' | 'harbor' | 'nexus';

export class MetricsError extends Error {
	readonly value: string;

	constructor(value: string, message: string) {
		super(message);
		this.name = 'MetricsError';
		this.value = value;
	}
}

/** Reads METRICS_BUCKETS: seconds, comma-separated, ascending. Throws a MetricsError for a value no histogram could use. */
export function parseBuckets(value: string | undefined): number[] {
	if (value === undefined || value.trim() === '') return DEFAULT_BUCKETS;
	const buckets = value.split(',').map((item) => (item.trim() === '' ? Number.NaN : Number(item)));
	const valid = buckets.every((bucket) => Number.isFinite(bucket) && bucket > 0) && buckets.every((bucket, index) => index === 0 || bucket > buckets[index - 1]);
	if (!valid) throw new MetricsError(value, 'it must be seconds above zero, in ascending order, separated by commas, like "0.1, 0.5, 1, 5, 10, 30"');
	return buckets;
}

/** What a cache store reports. Left out, `bytes` is a size the store cannot give without reading every entry, such as Redis's. */
export interface CacheStats {
	entries: number;
	bytes?: number;
}

/** Measuring walks the whole store, which a scrape every few seconds must not do each time. A write by this process measures anew. */
const CACHE_STATS_MAX_AGE_MS = 30_000;

interface MeasuredCacheStore {
	store: CacheStoreType;
	read: () => Promise<CacheStats>;
	/** Counts writes, so that a measure started before one is not kept. */
	version: number;
	cached?: { at: number; version: number; stats: CacheStats };
	pending?: Promise<CacheStats>;
}

interface Metrics {
	registry: Registry;
	cacheHits: Counter<'store'>;
	cacheMisses: Counter<'store'>;
	cacheWriteErrors: Counter<'store'>;
	cacheStats: { current?: MeasuredCacheStore };
	warmUpRuns: Counter;
	warmUpDuration: Histogram;
	warmUpUrlsFound: Counter;
	warmUpPagesWithProblems: Counter;
	sourceCacheLookups: Counter<'source' | 'status'>;
	sourceCalls: Counter<'source' | 'method' | 'outcome'>;
	sourceDuration: Histogram<'source' | 'method' | 'outcome'>;
	requests: Counter<'route' | 'status_class'>;
	renderDuration: Histogram<'route' | 'status_class'>;
}

// The server entry and start.ts each bundle this file, and both must count into the same registry.
const holder = globalThis as { __vitrineMetrics?: Metrics };

function metrics(): Metrics {
	holder.__vitrineMetrics ??= createMetrics(parseBuckets(process.env.METRICS_BUCKETS));
	return holder.__vitrineMetrics;
}

function createMetrics(buckets: number[]): Metrics {
	const registry = new Registry();
	collectDefaultMetrics({ register: registry });
	const cacheStats: Metrics['cacheStats'] = {};
	const scraped = (name: string, help: string, pick: (stats: CacheStats) => number | undefined) =>
		new Gauge({
			name,
			help,
			labelNames: ['store'],
			registers: [registry],
			async collect() {
				if (!cacheStats.current) return;
				try {
					const value = pick(await measure(cacheStats.current));
					if (value !== undefined) this.set({ store: cacheStats.current.store }, value);
				} catch (error) {
					console.error('Cache store could not be measured:', error);
				}
			},
		});
	scraped('vitrine_cache_entries', 'Entries the cache store holds, measured at most every 30 seconds.', ({ entries }) => entries);
	scraped('vitrine_cache_bytes', 'Bytes the cache store holds, measured at most every 30 seconds. Not reported for redis.', ({ bytes }) => bytes);
	const cacheCounter = (name: string, help: string) => new Counter({ name, help, labelNames: ['store'], registers: [registry] });
	return {
		registry,
		cacheStats,
		cacheHits: cacheCounter('vitrine_cache_hits_total', 'Cache reads that found an entry, fresh or Stale.'),
		cacheMisses: cacheCounter('vitrine_cache_misses_total', 'Cache reads that found no entry, or failed.'),
		cacheWriteErrors: cacheCounter('vitrine_cache_write_errors_total', 'Cache writes that failed.'),
		warmUpRuns: new Counter({ name: 'vitrine_warmup_runs_total', help: 'Warm-ups the server ran.', registers: [registry] }),
		warmUpDuration: new Histogram({ name: 'vitrine_warmup_duration_seconds', help: 'How long each warm-up took.', buckets, registers: [registry] }),
		warmUpUrlsFound: new Counter({ name: 'vitrine_warmup_urls_found_total', help: 'Distinct URLs of Vitrine that warm-ups saw.', registers: [registry] }),
		warmUpPagesWithProblems: new Counter({ name: 'vitrine_warmup_pages_with_problems_total', help: 'Pages that warm-ups found with problems.', registers: [registry] }),
		sourceCacheLookups: new Counter({
			name: 'vitrine_source_cache_lookups_total',
			help: 'Reads of a Source through the cache: a hit was answered from a fresh entry, a miss called the Source.',
			labelNames: ['source', 'status'],
			registers: [registry],
		}),
		sourceCalls: new Counter({ name: 'vitrine_source_http_calls_total', help: 'HTTP calls to Sources.', labelNames: ['source', 'method', 'outcome'], registers: [registry] }),
		sourceDuration: new Histogram({
			name: 'vitrine_source_http_call_duration_seconds',
			help: 'How long HTTP calls to Sources took to answer.',
			labelNames: ['source', 'method', 'outcome'],
			buckets,
			registers: [registry],
		}),
		requests: new Counter({ name: 'vitrine_http_requests_total', help: 'Pages requested, by Route and status class.', labelNames: ['route', 'status_class'], registers: [registry] }),
		renderDuration: new Histogram({
			name: 'vitrine_render_duration_seconds',
			help: 'How long pages took to render, by Route and status class.',
			labelNames: ['route', 'status_class'],
			buckets,
			registers: [registry],
		}),
	};
}

/** Creates the metrics, which stops startup when METRICS_BUCKETS is invalid. */
export function prepareMetrics() {
	metrics();
}

export function metricsText(): Promise<string> {
	return metrics().registry.metrics();
}

export const metricsContentType = () => metrics().registry.contentType;

/** Tells the metrics which cache store to measure on each scrape. */
export function measureCacheStore(store: CacheStoreType, read: () => Promise<CacheStats>) {
	metrics().cacheStats.current = { store, read, version: 0 };
}

/** The cache store has changed, so the next scrape measures it anew. */
export function cacheStoreChanged() {
	const current = metrics().cacheStats.current;
	if (current) current.version++;
}

/** One measure at a time, shared by both gauges and kept for CACHE_STATS_MAX_AGE_MS unless a write came since. */
async function measure(measured: MeasuredCacheStore): Promise<CacheStats> {
	const { cached, version } = measured;
	if (cached && cached.version === version && Date.now() - cached.at < CACHE_STATS_MAX_AGE_MS) return cached.stats;
	measured.pending ??= measured.read().then(
		(stats) => {
			measured.cached = { at: Date.now(), version, stats };
			measured.pending = undefined;
			return stats;
		},
		(error) => {
			measured.pending = undefined;
			throw error;
		},
	);
	return measured.pending;
}

export function countCacheRead(store: CacheStoreType, hit: boolean) {
	(hit ? metrics().cacheHits : metrics().cacheMisses).inc({ store });
}

export function countCacheWriteError(store: CacheStoreType) {
	metrics().cacheWriteErrors.inc({ store });
}

/** A read of a Source: a hit when a fresh entry answered it, a miss when the Source had to be called. */
export function countSourceCacheLookup(source: SourceType, status: 'hit' | 'miss') {
	metrics().sourceCacheLookups.inc({ source, status });
}

export function recordWarmUp({ durationMs, urlsFound, pagesWithProblems }: { durationMs: number; urlsFound: number; pagesWithProblems: number }) {
	const { warmUpRuns, warmUpDuration, warmUpUrlsFound, warmUpPagesWithProblems } = metrics();
	warmUpRuns.inc();
	warmUpDuration.observe(durationMs / 1000);
	warmUpUrlsFound.inc(urlsFound);
	warmUpPagesWithProblems.inc(pagesWithProblems);
}

/** The `route` of a request that matched no Route. Route URLs start with /, so it cannot be one. */
export const UNMATCHED_ROUTE = 'unmatched';

/** Counts a request and times its render, for the rate, errors and duration of each Route. */
export function recordRequest(route: string, status: number, seconds: number) {
	const labels = { route, status_class: outcomeOf(status) };
	metrics().requests.inc(labels);
	metrics().renderDuration.observe(labels, seconds);
}

function outcomeOf(status: number) {
	return `${Math.floor(status / 100)}xx`;
}

/** `fetch` for a call to a Source, counted and timed until the Source answers. A call that throws counts as `error`. */
export async function sourceFetch(source: SourceType, input: string | URL, init?: RequestInit): Promise<Response> {
	const { sourceCalls, sourceDuration } = metrics();
	const method = (init?.method ?? 'GET').toUpperCase();
	const started = performance.now();
	let outcome = 'error';
	try {
		const response = await fetch(input, init);
		outcome = outcomeOf(response.status);
		return response;
	} finally {
		const labels = { source, method, outcome };
		sourceCalls.inc(labels);
		sourceDuration.observe(labels, (performance.now() - started) / 1000);
	}
}
