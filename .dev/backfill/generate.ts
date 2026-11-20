// Fake metrics and logs for the dashboard: 7 days of what Vitrine exposes, in OpenMetrics text on stdout, for `promtool tsdb create-blocks-from openmetrics`,
// and, with BACKFILL_LOGS_FILE, of what it logs, for push-logs.ts. Run by .dev/compose.yaml in a Node container with the repository mounted:
// `node generate.ts > metrics.om`. It needs `npm install` to have run.
//
// It does not list the metrics: it plays a week of events through the real code of src/metrics.ts, one pod at a time, and scrapes its registry
// every few minutes, as Prometheus would. A new metric, label or bucket in src/metrics.ts shows up here once the events that feed it are played.
// Only the Node process metrics are not Vitrine's: this process's own are dropped, and the few the dashboard graphs are made up below.
// The logs go through the real src/logger.mjs, so they have its fields and its JSON; only their `time` is the moment they stand for. The same events
// feed both: a Source that fails is a metric and a log line.
//
// The story it tells, relative to now, so that every panel has something to show:
//   - a daily rhythm of visitors, quieter on weekends;
//   - three pods behind one Service, each with an address of its own; a deploy replaces them one after the other;
//   - 4 days ago, 0.5.0 is deployed and makes the GitLab pages slow and flaky, and one pod crashes twice; a hotfix, 0.5.1, follows after half a day;
//   - 5 days ago, Redis is flushed: the cache empties, refills, and writes fail for a few minutes;
//   - yesterday, main-gitlab is down for 45 minutes;
//   - staging-nexus is flaky all along.

import {
	cacheStoreChanged,
	countCacheRead,
	countCacheWriteError,
	countSourceCacheLookup,
	measureCacheStore,
	metricsText,
	prepareMetrics,
	recordRequest,
	recordSourceCall,
	recordWarmUp,
	UNMATCHED_ROUTE,
} from '../../src/metrics.ts';
import type { SourceType } from '../../src/metrics.ts';
import { astroDestination, createLogger } from '../../src/logger.mjs';
import { closeSync, openSync, writeSync } from 'node:fs';

const DAYS = Number(process.env.BACKFILL_DAYS ?? 7);
const STEP = Number(process.env.BACKFILL_STEP_SECONDS ?? 180);
const STORE = 'redis';
const PEAK_RPS = 5;

const end = Math.floor(Date.now() / 1000 / STEP) * STEP;
const start = end - DAYS * 86400;
const N = (end - start) / STEP + 1;
const at = (i: number) => start + i * STEP;
const snap = (t: number) => Math.round(t / STEP) * STEP;

// ---- Random numbers: seeded, so that two runs tell the same story.

let seed = 20260611;
function random() {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function normal() {
	return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}
function poisson(mean: number): number {
	if (mean <= 0) return 0;
	if (mean > 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * normal()));
	const limit = Math.exp(-mean);
	let k = 0;
	for (let p = random(); p > limit; p *= random()) k++;
	return k;
}
const binomial = (n: number, p: number) => Math.min(n, poisson(n * Math.min(1, Math.max(0, p))));
/** A duration around `median` seconds. */
const lognormal = (median: number, sigma: number) => median * Math.exp(sigma * normal());
const times = (n: number, run: () => void) => {
	for (let i = 0; i < n; i++) run();
};

// ---- The story.

const deploys = [snap(end - 4 * 86400), snap(end - 3.5 * 86400)];
const outageFrom = snap(end - 26 * 3600);
const outage = (t: number) => t >= outageFrom && t < outageFrom + 45 * 60;
const redisFlush = snap(end - 5 * 86400);
const redisFlushing = (t: number) => t >= redisFlush && t < redisFlush + 20 * 60;

/** 0 to 1: Visitors over the day (peaking at 13:00 UTC), and over the week. */
function load(t: number) {
	const date = new Date(t * 1000);
	const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
	const day = hour >= 6 && hour <= 20 ? Math.max(0.05, Math.sin((Math.PI * (hour - 6)) / 14)) : 0.05;
	const week = date.getUTCDay() === 0 || date.getUTCDay() === 6 ? 0.35 : 1;
	return day * week;
}

// Routes, as in settings.example.yaml. `median` is the seconds a 2xx page takes to render.
interface Route {
	url: string;
	share: number;
	median: number;
	/** Sources the page reads, with the reads of each per render. */
	reads: Array<[source: string, reads: number]>;
	baseErrorRate: number;
}
const ROUTES: Route[] = [
	{ url: '/', share: 0.2, median: 0.06, reads: [['main-harbor', 1], ['main-gitlab', 1]], baseErrorRate: 0.001 },
	{ url: '/images', share: 0.12, median: 0.15, reads: [['main-harbor', 2], ['tools-harbor', 1]], baseErrorRate: 0.002 },
	{ url: '/harbor/:source', share: 0.1, median: 0.25, reads: [['main-harbor', 2]], baseErrorRate: 0.002 },
	{ url: '/harbor/:source/:project', share: 0.1, median: 0.35, reads: [['main-harbor', 2], ['tools-harbor', 1]], baseErrorRate: 0.003 },
	{ url: '/gitlab/:group+', share: 0.14, median: 0.6, reads: [['main-gitlab', 3]], baseErrorRate: 0.003 },
	{ url: '/gitlab/:group+/-/:project', share: 0.1, median: 0.8, reads: [['main-gitlab', 4]], baseErrorRate: 0.004 },
	{ url: '/roadmap/:group+', share: 0.06, median: 0.9, reads: [['main-gitlab', 4]], baseErrorRate: 0.004 },
	{ url: '/issues/:group+', share: 0.06, median: 0.7, reads: [['main-gitlab', 3]], baseErrorRate: 0.004 },
	{ url: '/nexus/:source', share: 0.08, median: 0.4, reads: [['main-nexus', 2], ['staging-nexus', 1]], baseErrorRate: 0.003 },
	{ url: '/search', share: 0.04, median: 1.2, reads: [['main-gitlab', 6]], baseErrorRate: 0.006 },
];
/** A request no Route matched: always a 404. */
const UNMATCHED = { share: 0.02, median: 0.02 };
const dependsOnGitlab = (route: Route) => route.reads.some(([source]) => source === 'main-gitlab');

/** What a call to a Source answers: a status, or `error` for a call that failed without an answer. */
type Result = 200 | 404 | 503 | 'error';
interface SourceProfile {
	type: SourceType;
	/** Share of reads that call the Source: the cache answers the rest. */
	missRate: number;
	/** Calls per miss: pages to walk. */
	pages: number;
	median: number;
	/** The share of each method's calls that end in a 4xx, a 5xx, or an error; the rest answer 2xx. */
	methods: Record<string, { share: number; '4xx': number; '5xx': number; error: number }>;
}
const SOURCES: Record<string, SourceProfile> = {
	'main-gitlab': { type: 'gitlab', missRate: 0.1, pages: 1.6, median: 0.5, methods: { GET: { share: 0.55, '4xx': 0.01, '5xx': 0.004, error: 0.002 }, POST: { share: 0.45, '4xx': 0, '5xx': 0.003, error: 0.002 } } },
	'main-harbor': { type: 'harbor', missRate: 0.08, pages: 1.3, median: 0.15, methods: { GET: { share: 1, '4xx': 0.008, '5xx': 0.002, error: 0 } } },
	'tools-harbor': { type: 'harbor', missRate: 0.08, pages: 1.1, median: 0.12, methods: { GET: { share: 1, '4xx': 0.004, '5xx': 0, error: 0 } } },
	'main-nexus': { type: 'nexus', missRate: 0.12, pages: 1.4, median: 0.3, methods: { GET: { share: 1, '4xx': 0.015, '5xx': 0.003, error: 0 } } },
	'staging-nexus': { type: 'nexus', missRate: 0.15, pages: 1.4, median: 0.9, methods: { GET: { share: 1, '4xx': 0.01, '5xx': 0.04, error: 0.03 } } },
};

// ---- Output: the registry of a pod, as Prometheus would scrape it, with a timestamp.

/** Metrics of Node, not of Vitrine: the ones of this very process are dropped, and the dashboard's own are made up. */
const isNodeMetric = (name: string) => name.startsWith('process_') || name.startsWith('nodejs_');

/** A sample of Prometheus's text format: `name{labels} value`. */
const SAMPLE = /^([A-Za-z_:][A-Za-z0-9_:]*)(?:\{(.*)\})? (\S+)$/;

const out: string[] = [];
const flush = () => {
	process.stdout.write(out.join(''));
	out.length = 0;
};

function emit(name: string, labels: string, value: number | string, t: number, instance: string) {
	const own = labels ? `${labels},` : '';
	const text = typeof value === 'number' && !Number.isInteger(value) ? value.toPrecision(7) : value;
	out.push(`${name}{${own}job="vitrine",instance="${instance}"} ${text} ${t}\n`);
}

// ---- Logs.

const logsFile = process.env.BACKFILL_LOGS_FILE ? openSync(process.env.BACKFILL_LOGS_FILE, 'w') : undefined;
let captured = '';
const environment = { LOG_LEVEL: 'debug' };
const write = (line: string) => {
	captured = line;
};
const logger = createLogger({ env: environment, write });
const astro = astroDestination({ env: environment, write });

type Level = 'info' | 'warn' | 'error';
interface LogLine {
	ms: number;
	level: Level;
	line: string;
}
let pending: LogLine[] = [];

/** One line of a pod's log, written by the real logger, with the moment it stands for in place of the generator's own. */
function stamp(ms: number, level: Level) {
	const entry = JSON.parse(captured) as Record<string, unknown>;
	entry.time = new Date(ms).toISOString();
	pending.push({ ms, level, line: JSON.stringify(entry) });
}
function logAt(ms: number, level: Level, msg: string, fields: Record<string, unknown> = {}) {
	if (!logsFile) return;
	logger[level](msg, fields);
	stamp(ms, level);
}
/** What a log has of an error: its message and its stack, as the logger prints them. */
function failure(name: string, message: string) {
	return Object.assign(new Error(message), { stack: `${name}: ${message}\n    at async withTimeout (file:///app/dist/server/chunks/content-cache.mjs:98:12)\n    at async readUncached (file:///app/dist/server/chunks/content-cache.mjs:51:20)` });
}

/** The lines of a step, one tab-separated record each: moment in nanoseconds, instance, level, JSON. Several lines of a millisecond keep their order. */
function flushLogs(instance: string) {
	if (!logsFile) return;
	pending.sort((a, b) => a.ms - b.ms);
	const records = pending.map(({ ms, level, line }, index) => `${BigInt(ms) * 1_000_000n + BigInt(index)}\t${instance}\t${level}\t${line}\n`);
	writeSync(logsFile, records.join(''));
	pending = [];
}

const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
const GROUPS = ['platform', 'data/analytics', 'security'];
const PROJECTS = ['api', 'gateway', 'web', 'infra', 'docs', 'billing'];
/** A page of a Route, as a Visitor or a warm-up asks for it. */
const pathOf = (route: Route) => route.url.replace(':source', pick(route.reads)[0]).replace(':project', pick(PROJECTS)).replace(':group+', pick(GROUPS));
/** The key of a cached read of a Source: its name, then what it reads. */
function keyOf(name: string, type: SourceType) {
	if (type === 'gitlab') return random() < 0.5 ? `${name}/members/${pick(GROUPS)}` : `${name}/member/${Math.floor(random() * 900) + 100}/profile`;
	if (type === 'harbor') return random() < 0.7 ? `${name}/images/${pick(PROJECTS)}` : `${name}/projects`;
	return `${name}/repositories`;
}

// ---- One pod, from its start to its end: a new pod, with a new address, is a new registry that starts from 0.

interface Pod {
	instance: string;
	version: string;
	from: number;
	to: number;
	/** Seconds since the epoch: before the backfill, for the pods that run when it starts. */
	startedAt: number;
	/** The share of the visitors the Service sends to this pod. */
	share: number;
	/** Pods warm up at moments of their own. */
	warmUpOffset: number;
}

async function simulate(pod: Pod) {
	const first = Math.max(0, Math.round((pod.from - start) / STEP));
	const last = Math.min(N, Math.round((pod.to - start) / STEP));
	const bad = pod.version === '0.5.0';

	// A fresh registry, as in a process that has just started: the holder of src/metrics.ts is where it keeps it.
	(globalThis as { __vitrineMetrics?: unknown }).__vitrineMetrics = undefined;
	process.env.VITRINE_VERSION = pod.version;
	prepareMetrics();
	let entries = 0;
	measureCacheStore(STORE, async () => ({ entries }));
	if (logsFile && pod.from > start) {
		const booted = pod.from * 1000;
		logAt(booted, 'info', 'Starting Vitrine', { version: pod.version });
		astro.write({ level: 'info', message: 'Server listening on http://0.0.0.0:4321', label: '@astrojs/node' });
		stamp(booted + 650, 'info');
		logAt(booted + 700, 'warn', `The Templates of these Routes run as code on the server, so only people trusted with the server may edit Settings: ${ROUTES.map(({ url }) => `"${url}"`).join(', ')}`);
	}

	let cpuUser = 0;
	let cpuSystem = 0;

	for (let i = first; i < last; i++) {
		const t = at(i);
		const busy = load(t);
		const wobble = 1 + 0.08 * normal();
		const ageHours = (t - pod.startedAt) / 3600;
		const gitlabDown = outage(t);
		/** A moment of this step, at random. */
		const moment = () => t * 1000 + Math.floor(random() * STEP * 1000);

		// Pages.
		const readsPerSource = new Map<string, number>();
		let allReads = 0;
		const slowdown = (route: Route) => (bad && dependsOnGitlab(route) ? 1.9 : 1) * (1 + 0.25 * busy);
		for (const route of ROUTES) {
			const total = poisson(PEAK_RPS * pod.share * route.share * busy * STEP * wobble);
			const failRate = route.baseErrorRate + (dependsOnGitlab(route) ? (gitlabDown ? 0.45 : bad ? 0.03 : 0) : 0);
			const failed = binomial(total, failRate);
			times(total - failed, () => recordRequest(route.url, 200, lognormal(route.median * slowdown(route), 0.6)));
			times(failed, () => recordRequest(route.url, 503, lognormal(gitlabDown && dependsOnGitlab(route) ? 8 : 0.3, 0.5)));
			times(failed, () =>
				logAt(moment(), 'error', 'Template failed', {
					path: pathOf(route),
					error: failure('TypeError', gitlabDown && dependsOnGitlab(route) ? "Cannot read properties of undefined (reading 'name')" : pick(["Cannot read properties of undefined (reading 'name')", 'projects.map is not a function', 'The Template took too long'])),
				}),
			);
			for (const [source, reads] of route.reads) {
				readsPerSource.set(source, (readsPerSource.get(source) ?? 0) + total * reads);
				allReads += total * reads;
			}
		}
		times(poisson(PEAK_RPS * pod.share * UNMATCHED.share * busy * STEP * wobble), () => recordRequest(UNMATCHED_ROUTE, 404, lognormal(UNMATCHED.median, 0.4)));

		// Sources: the cache answers most reads, the rest call the Source.
		let sourceMisses = 0;
		for (const [name, profile] of Object.entries(SOURCES)) {
			const source = { type: profile.type, name };
			const reads = Math.round(readsPerSource.get(name) ?? 0);
			const down = gitlabDown && name === 'main-gitlab';
			const misses = binomial(reads, profile.missRate * (down ? 4 : bad && name === 'main-gitlab' ? 1.5 : 1));
			times(reads - misses, () => countSourceCacheLookup(source, 'hit'));
			times(misses, () => countSourceCacheLookup(source, 'miss'));
			sourceMisses += misses;
			const pages = Math.round(misses * profile.pages);
			for (const [method, shares] of Object.entries(profile.methods)) {
				const methodCalls = Math.round(pages * shares.share);
				const failures = { 404: binomial(methodCalls, down ? 0 : shares['4xx']), 503: binomial(methodCalls, down ? 0.4 : shares['5xx']), error: binomial(methodCalls, down ? 0.5 : shares.error) };
				const counts: Record<Result, number> = { 200: Math.max(0, methodCalls - failures[404] - failures[503] - failures.error), ...failures };
				const medians: Record<Result, number> = { 200: profile.median * (bad && name === 'main-gitlab' ? 1.7 : 1) * (1 + 0.2 * busy), 404: profile.median * 0.5, 503: profile.median * 2, error: 10 };
				for (const result of [200, 404, 503, 'error'] as const) {
					times(counts[result], () => recordSourceCall(source, method, result, lognormal(medians[result], result === 'error' ? 0.25 : 0.7)));
				}
				// A call that fails is a Source that could not be loaded.
				times(counts[503], () => logAt(moment(), 'error', 'Could not load a Source', { key: keyOf(name, profile.type), error: failure('Error', `${profile.type} answered 503 Service Unavailable`) }));
				times(counts.error, () => logAt(moment(), 'error', 'Could not load a Source', { key: keyOf(name, profile.type), error: failure('TimeoutError', 'The operation was aborted due to timeout') }));
			}
		}

		// The cache store reads a little more than the Sources: entries that are not Source reads. Redis is shared, so every pod sees the same entries.
		const otherReads = Math.round(allReads * 0.3);
		const otherMisses = binomial(otherReads, 0.02);
		times(Math.round(allReads) - sourceMisses + otherReads - otherMisses, () => countCacheRead(STORE, true));
		times(sourceMisses + otherMisses, () => countCacheRead(STORE, false));
		const writeErrors = redisFlushing(t) ? poisson((0.8 * STEP) / 3) : poisson((0.0005 * STEP) / 3);
		times(writeErrors, () => countCacheWriteError(STORE));
		const redisDown = () => failure('Error', 'connect ECONNREFUSED 10.43.12.7:6379');
		const anySource = () => {
			const [name, profile] = pick(Object.entries(SOURCES));
			return keyOf(name, profile.type);
		};
		times(writeErrors, () => logAt(moment(), 'error', 'Cache store could not write', { key: anySource(), error: redisDown() }));
		times(redisFlushing(t) ? poisson((0.4 * STEP) / 3) : 0, () => logAt(moment(), 'error', 'Cache store could not read', { key: anySource(), error: redisDown() }));
		const filled = t < redisFlush ? 1 : 1 - Math.exp(-(t - redisFlush) / 3600 / 8);
		entries = Math.round(filled * (14500 + 400 * Math.sin(t / 86400)) + 5 * Math.sin(t / 700));
		cacheStoreChanged();

		// Warm-ups run every half hour, and at each start.
		if ((t - pod.warmUpOffset) % 1800 < STEP || i === first) {
			const report = { durationMs: lognormal(12 * (gitlabDown ? 2.5 : bad ? 1.8 : 1), 0.35) * 1000, urlsFound: poisson(430), pagesWithProblems: poisson(gitlabDown ? 70 : bad ? 15 : 2) };
			recordWarmUp(report);
			// The report is logged when the warm-up is over: one line per page, then a summary, as src/warm-up.ts does.
			const over = moment();
			const problem = () => (gitlabDown ? pick(['main-gitlab could not be reached, so the content is Stale', 'status 503']) : bad ? pick(['status 500', 'The operation was aborted due to timeout']) : pick(['status 500', 'status 502']));
			for (let page = 0; page < report.urlsFound; page++) {
				const failed = page < report.pagesWithProblems;
				const path = pathOf(pick(ROUTES));
				if (failed) logAt(over, 'error', 'Warm-up page failed', { path, problems: [problem()] });
				else logAt(over, 'info', 'Warm-up page ok', { path });
			}
			const fields = { baseUrl: 'http://localhost:4321', pages: report.urlsFound, failed: report.pagesWithProblems, seconds: Math.round(report.durationMs / 100) / 10 };
			logAt(over, report.pagesWithProblems > 0 ? 'error' : 'info', 'Warm-up finished', fields);
			if (gitlabDown && random() < 0.08) logAt(over + 5, 'error', 'The warm-up stopped', { error: failure('TypeError', 'fetch failed') });
		}

		flushLogs(pod.instance);

		// The scrape.
		for (const line of (await metricsText()).split('\n')) {
			const sample = SAMPLE.exec(line);
			if (!sample || line.startsWith('#') || isNodeMetric(sample[1])) continue;
			emit(sample[1], sample[2] ?? '', sample[3], t, pod.instance);
		}

		// The Node process, made up: CPU follows the visitors, memory grows between restarts, and 0.5.0 is heavier.
		const cpu = (0.03 + 0.25 * busy * pod.share * 3 * (bad ? 1.6 : 1)) * wobble;
		cpuUser += cpu * STEP * 0.8;
		cpuSystem += cpu * STEP * 0.2;
		const memory = (190 + 2.5 * ageHours + 45 * busy + 3 * normal()) * 1024 * 1024;
		emit('up', '', 1, t, pod.instance);
		emit('process_cpu_user_seconds_total', '', cpuUser, t, pod.instance);
		emit('process_cpu_system_seconds_total', '', cpuSystem, t, pod.instance);
		emit('process_start_time_seconds', '', pod.startedAt, t, pod.instance);
		emit('process_resident_memory_bytes', '', memory, t, pod.instance);
		emit('nodejs_heap_size_used_bytes', '', memory * 0.55, t, pod.instance);
		emit('nodejs_heap_size_total_bytes', '', memory * 0.7, t, pod.instance);
		emit('nodejs_eventloop_lag_p99_seconds', '', 0.004 * (1 + 3 * busy) * (bad ? 3 : 1) * (1 + 0.15 * Math.abs(normal())), t, pod.instance);
		emit('process_open_fds', '', Math.round(40 + 25 * busy + 2 * normal()), t, pod.instance);
		if (out.length > 50_000) flush();
	}
}

// ---- The Deployment: three pods, replaced one after the other at each deploy. A pod that leaves takes its address, and a new one arrives with another.

const SHARES = [0.36, 0.33, 0.31];
const rollout = (deploy: number, slot: number) => deploy + slot * 2 * STEP;
let podNumber = 10;
for (const [slot, share] of SHARES.entries()) {
	interface Release {
		version: string;
		from: number;
		startedAt: number;
		/** The container crashed and restarted inside its pod: same address, counters from 0. */
		sameAddress?: boolean;
	}
	const schedule: Release[] = [
		{ version: '0.4.2', from: start, startedAt: start - (20 + 7 * slot) * 3600 },
		{ version: '0.5.0', from: rollout(deploys[0], slot), startedAt: rollout(deploys[0], slot) },
		{ version: '0.5.1', from: rollout(deploys[1], slot), startedAt: rollout(deploys[1], slot) },
	];
	// 0.5.0 leaks: the second pod crashes twice before the hotfix.
	if (slot === 1) {
		for (const hours of [4, 8]) {
			const from = rollout(deploys[0], slot) + snap(hours * 3600);
			schedule.splice(schedule.length - 1, 0, { version: '0.5.0', from, startedAt: from, sameAddress: true });
		}
	}
	let instance = '';
	for (const [index, release] of schedule.entries()) {
		if (!release.sameAddress) instance = `10.42.${slot}.${podNumber++}:4321`;
		const to = index + 1 < schedule.length ? schedule[index + 1].from : end + STEP;
		await simulate({ instance, version: release.version, from: release.from, to, startedAt: release.startedAt, share, warmUpOffset: slot * 600 });
	}
}

out.push('# EOF\n');
flush();
if (logsFile) closeSync(logsFile);
// The default metrics of every registry keep an event loop monitor running.
process.exit(0);
