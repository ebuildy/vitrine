// Builds dashboards/vitrine.json, the Grafana dashboard of the metrics in src/metrics.ts: `node .dev/grafana/build-dashboard.ts`.
// It uses the v2 schema of Grafana (dashboard.grafana.app/v2), which has tabs and rows. Edit this file, not the JSON.

import { writeFileSync } from 'node:fs';

const DATASOURCE = 'prometheus';
const LOKI = 'loki';
const PLUGIN_VERSION = '13.3.1';

// ---- Selectors: the variables of the dashboard, applied to the label each metric carries.

const ROUTE = 'route=~"$route"';
const SOURCE = 'name=~"$source_name"';
const STORE = 'store=~"$store"';
const R = '$__rate_interval';
/** The logs of the pods the variables select. `level` is a label of the stream: info, warn or error. Loki wants a matcher that does not match an empty value: with All, job and instance do. */
const LOGS = '{level=~".+",job=~"$job",instance=~"$instance"}';
const ERRORS = '{job=~"$job",instance=~"$instance",level="error"}';
/** A stat with one tile per pod. An instant query of Loki comes as the rows of one frame, so each row is a tile, named by its label. */
const PER_INSTANCE = { textMode: 'value_and_name', reduceOptions: { calcs: ['lastNotNull'], fields: '', values: true } };
const WARNINGS = '{job=~"$job",instance=~"$instance",level="warn"}';
/** The version each pod runs, as a series of 1 to join on: a pod is a job and an instance. During a rollout, pods run different versions at once. */
const VERSION_OF_POD = 'on(job, instance) group_left(version) max by (job, instance, version) (vitrine_build_info)';

/** Filters every metric of an expression by the `job` and `instance` variables: several installations of Vitrine, each with several pods, share one dashboard. */
const withJob = (expr: string) =>
	expr.replace(/\b((?:vitrine|process|nodejs)_[a-z0-9_]+|up(?=\{))(\{([^}]*)\})?/g, (match, name: string, _braces, labels?: string) => {
		const pods = 'job=~"$job",instance=~"$instance"';
		if (labels === undefined) return `${name}{${pods}}`;
		if (/\bjob\b/.test(labels)) return match;
		return `${name}{${pods}${labels.trim() ? `,${labels}` : ''}}`;
	});

// ---- Panels.

type Unit = 'reqps' | 'percentunit' | 's' | 'bytes' | 'short' | 'ops' | 'none' | 'cps';
interface Query {
	expr: string;
	legend?: string;
	/** An instant query, one value per series: for stats, bar gauges and tables. */
	instant?: boolean;
	format?: 'time_series' | 'table' | 'heatmap';
}
interface Panel {
	type: 'timeseries' | 'stat' | 'bargauge' | 'heatmap' | 'table' | 'state-timeline' | 'logs';
	/** Where the queries go: Prometheus, unless it says Loki. */
	datasource?: typeof DATASOURCE | typeof LOKI;
	title: string;
	description?: string;
	width: number;
	height: number;
	queries: Query[];
	unit?: Unit;
	/** Where a stat or bar gauge turns orange, then red. */
	thresholds?: [warn: number, bad: number];
	/** Higher is better: the colors go the other way. */
	lowIsBad?: boolean;
	stack?: boolean;
	bars?: boolean;
	min?: number;
	max?: number;
	noValue?: string;
	/** Series names and the color each takes. */
	colors?: Record<string, string>;
	transformations?: Array<{ id: string; options: Record<string, unknown> }>;
	overrides?: Array<{ matcher: { id: string; options: string }; properties: Array<{ id: string; value: unknown }> }>;
	options?: Record<string, unknown>;
	custom?: Record<string, unknown>;
}

const GREEN = 'green';
const ORANGE = 'orange';
const RED = 'red';
const STATUS_COLORS = { '2xx': 'green', '3xx': 'blue', '4xx': 'yellow', '5xx': 'red', error: 'purple' };

const q = (expr: string, legend?: string, extra: Partial<Query> = {}): Query => ({ expr, legend, ...extra });
const stat = (p: Omit<Panel, 'type' | 'width' | 'height'> & Partial<Pick<Panel, 'width' | 'height'>>): Panel => ({ type: 'stat', width: 4, height: 4, ...p, queries: p.queries.map((query) => ({ instant: true, ...query })) });
const series = (p: Omit<Panel, 'type' | 'width' | 'height'> & Partial<Pick<Panel, 'width' | 'height'>>): Panel => ({ type: 'timeseries', width: 12, height: 8, ...p });
const bars = (p: Omit<Panel, 'type' | 'width' | 'height'> & Partial<Pick<Panel, 'width' | 'height'>>): Panel => ({ type: 'bargauge', width: 12, height: 8, ...p, queries: p.queries.map((query) => ({ instant: true, ...query })) });
const heatmap = (p: Omit<Panel, 'type' | 'width' | 'height' | 'queries'> & Partial<Pick<Panel, 'width' | 'height'>> & { metric: string; selector: string; window?: string }): Panel => ({
	type: 'heatmap',
	width: 12,
	height: 8,
	unit: 's',
	...p,
	queries: [q(`sum by (le) (increase(${p.metric}_bucket{${p.selector}}[${p.window ?? R}]))`, '{{le}}', { format: 'heatmap' })],
});

/** The quantile of a histogram over some labels, as a time series. */
const quantile = (phi: number, metric: string, selector: string, by = '', window = R) => `histogram_quantile(${phi}, sum by (le${by ? `, ${by}` : ''}) (rate(${metric}_bucket{${selector}}[${window}])))`;

// ---- Tabs, rows.

interface Row {
	title: string;
	collapse?: boolean;
	panels: Panel[];
}
interface Tab {
	title: string;
	rows: Row[];
	/** Variables of this tab only. */
	scoped?: () => unknown[];
}

const REQUESTS = 'vitrine_http_requests_total';
const RENDER = 'vitrine_render_duration_seconds';
const CALLS = 'vitrine_source_http_calls_total';
const CALL_DURATION = 'vitrine_source_http_call_duration_seconds';
const LOOKUPS = 'vitrine_source_cache_lookups_total';
const WARMUP_DURATION = 'vitrine_warmup_duration_seconds';

/** Warm-ups run every few minutes at most: windows of a rate interval hold too few of them. */
const HOUR = '1h';

const tabs: Tab[] = [
	{
		title: 'Overview',
		rows: [
			{
				title: 'Over the selected time range',
				panels: [
					stat({ title: 'Pages / s', unit: 'reqps', description: 'Pages requested, all Routes selected.', queries: [q(`sum(rate(${REQUESTS}{${ROUTE}}[$__range]))`)] }),
					stat({
						title: '5xx pages',
						unit: 'percentunit',
						thresholds: [0.01, 0.05],
						description: 'Share of pages that answered 5xx.',
						queries: [q(`sum(increase(${REQUESTS}{${ROUTE},status_class="5xx"}[$__range])) / sum(increase(${REQUESTS}{${ROUTE}}[$__range]))`)],
					}),
					stat({
						title: 'Render p95',
						unit: 's',
						thresholds: [1, 3],
						description: 'How long 95% of the pages took to render.',
						queries: [q(quantile(0.95, RENDER, ROUTE, '', '$__range'))],
					}),
					stat({
						title: 'Cache hit ratio',
						unit: 'percentunit',
						thresholds: [0.9, 0.8],
						lowIsBad: true,
						description: 'Cache reads that found an entry, fresh or Stale.',
						queries: [q(`sum(increase(vitrine_cache_hits_total{${STORE}}[$__range])) / (sum(increase(vitrine_cache_hits_total{${STORE}}[$__range])) + sum(increase(vitrine_cache_misses_total{${STORE}}[$__range])))`)],
					}),
					stat({
						title: 'Source failures',
						unit: 'percentunit',
						thresholds: [0.01, 0.05],
						description: 'Calls to Sources that answered 5xx or failed without an answer.',
						queries: [q(`sum(increase(${CALLS}{${SOURCE},outcome=~"5xx|error"}[$__range])) / sum(increase(${CALLS}{${SOURCE}}[$__range]))`)],
					}),
					stat({
						title: 'Warm-up problems / run',
						unit: 'none',
						thresholds: [5, 20],
						description: 'Pages with problems that a warm-up finds, on average.',
						queries: [q('sum(increase(vitrine_warmup_pages_with_problems_total[$__range])) / sum(increase(vitrine_warmup_runs_total[$__range]))')],
					}),
				],
			},
			{
				title: 'Traffic and errors',
				panels: [
					series({
						title: 'Pages / s by status class',
						unit: 'reqps',
						stack: true,
						colors: STATUS_COLORS,
						queries: [q(`sum by (status_class) (rate(${REQUESTS}{${ROUTE}}[${R}]))`, '{{status_class}}')],
					}),
					series({
						title: '5xx ratio',
						unit: 'percentunit',
						thresholds: [0.01, 0.05],
						description: 'Share of pages that answered 5xx. Alert on this one.',
						queries: [q(`sum(rate(${REQUESTS}{${ROUTE},status_class="5xx"}[${R}])) / sum(rate(${REQUESTS}{${ROUTE}}[${R}]))`, '5xx')],
					}),
					series({
						title: 'Render duration',
						unit: 's',
						queries: [0.5, 0.95, 0.99].map((phi) => q(quantile(phi, RENDER, ROUTE), `p${phi * 100}`)),
					}),
					series({
						title: 'Source call failures',
						unit: 'percentunit',
						description: '5xx and failed calls to each Source, as a share of its calls.',
						queries: [q(`sum by (name) (rate(${CALLS}{${SOURCE},outcome=~"5xx|error"}[${R}])) / sum by (name) (rate(${CALLS}{${SOURCE}}[${R}]))`, '{{name}}')],
					}),
				],
			},
			{
				title: 'Releases',
				panels: [
					{
						type: 'state-timeline',
						title: 'Version that runs',
						description: 'vitrine_build_info: one band per pod and version, to tie a regression to a deploy. A rollout shows pods of two versions side by side.',
						width: 24,
						height: 7,
						queries: [q('max by (job, instance, version) (vitrine_build_info)', '{{instance}} {{version}}')],
						options: { mergeValues: true, showValue: 'never', rowHeight: 0.8, legend: { showLegend: false } },
					},
					series({
						title: '5xx ratio by version',
						unit: 'percentunit',
						thresholds: [0.01, 0.05],
						description: `${'`'}vitrine_build_info${'`'} joined, pod by pod, to the 5xx ratio: each line is a release, even while a rollout runs two at once.`,
						queries: [q(`sum by (job, version) (rate(${REQUESTS}{status_class="5xx"}[${R}]) * ${VERSION_OF_POD}) / sum by (job, version) (rate(${REQUESTS}[${R}]) * ${VERSION_OF_POD})`, '{{job}} {{version}}')],
					}),
					series({
						title: 'Render p95 by version',
						unit: 's',
						queries: [q(`histogram_quantile(0.95, sum by (le, job, version) (rate(${RENDER}_bucket[${R}]) * ${VERSION_OF_POD}))`, '{{job}} {{version}}')],
					}),
				],
			},
		],
	},
	{
		title: 'Pages',
		rows: [
			{
				title: 'Traffic',
				panels: [
					series({ title: 'Pages / s by Route', unit: 'reqps', stack: true, queries: [q(`sum by (route) (rate(${REQUESTS}{${ROUTE}}[${R}]))`, '{{route}}')], width: 16 }),
					bars({
						title: 'Share of pages by Route',
						unit: 'reqps',
						description: 'Average pages per second over the selected time range.',
						width: 8,
						queries: [q(`sort_desc(sum by (route) (rate(${REQUESTS}{${ROUTE}}[$__range])))`, '{{route}}')],
					}),
					series({ title: 'Pages / s by status class', unit: 'reqps', stack: true, colors: STATUS_COLORS, queries: [q(`sum by (status_class) (rate(${REQUESTS}{${ROUTE}}[${R}]))`, '{{status_class}}')] }),
					series({
						title: 'Unmatched requests / s',
						unit: 'reqps',
						description: 'Requests that matched no Route (404): `route="unmatched"`. A rise is a broken link, or a scanner.',
						queries: [q(`sum(rate(${REQUESTS}{route="unmatched"}[${R}]))`, 'unmatched')],
					}),
				],
			},
			{
				title: 'Errors',
				panels: [
					series({
						title: '5xx ratio by Route',
						unit: 'percentunit',
						thresholds: [0.01, 0.05],
						queries: [q(`sum by (route) (rate(${REQUESTS}{${ROUTE},status_class="5xx"}[${R}])) / sum by (route) (rate(${REQUESTS}{${ROUTE}}[${R}]))`, '{{route}}')],
					}),
					series({
						title: '5xx pages / s by Route',
						unit: 'reqps',
						stack: true,
						queries: [q(`sum by (route) (rate(${REQUESTS}{${ROUTE},status_class="5xx"}[${R}]))`, '{{route}}')],
					}),
				],
			},
			{
				title: 'Latency',
				panels: [
					series({ title: 'Render duration', unit: 's', queries: [0.5, 0.95, 0.99].map((phi) => q(quantile(phi, RENDER, ROUTE), `p${phi * 100}`)) }),
					series({ title: 'Render p95 by Route', unit: 's', queries: [q(quantile(0.95, RENDER, ROUTE, 'route'), '{{route}}')] }),
					heatmap({
						title: 'Render duration distribution',
						description: 'Pages per bucket of `METRICS_BUCKETS`: the darker, the more pages. The top bucket holds the slowest.',
						metric: RENDER,
						selector: ROUTE,
						width: 24,
					}),
				],
			},
			{
				title: 'By Route',
				panels: [
					{
						type: 'table',
						title: 'Routes over the selected time range',
						width: 24,
						height: 9,
						queries: [
							q(`sum by (route) (rate(${REQUESTS}{${ROUTE}}[$__range]))`, '', { instant: true, format: 'table' }),
							q(`sum by (route) (increase(${REQUESTS}{${ROUTE},status_class="5xx"}[$__range])) / sum by (route) (increase(${REQUESTS}{${ROUTE}}[$__range]))`, '', { instant: true, format: 'table' }),
							q(quantile(0.5, RENDER, ROUTE, 'route', '$__range'), '', { instant: true, format: 'table' }),
							q(quantile(0.95, RENDER, ROUTE, 'route', '$__range'), '', { instant: true, format: 'table' }),
						],
						transformations: [
							{ id: 'joinByField', options: { byField: 'route', mode: 'outer' } },
							{
								id: 'organize',
								options: {
									excludeByName: { 'Time 1': true, 'Time 2': true, 'Time 3': true, 'Time 4': true },
									indexByName: {},
									renameByName: { 'Value #A': 'Pages / s', 'Value #B': '5xx', 'Value #C': 'p50', 'Value #D': 'p95', route: 'Route' },
								},
							},
						],
						overrides: [
							{ matcher: { id: 'byName', options: 'Pages / s' }, properties: [{ id: 'unit', value: 'reqps' }, { id: 'decimals', value: 3 }] },
							{ matcher: { id: 'byName', options: '5xx' }, properties: [{ id: 'unit', value: 'percentunit' }, { id: 'custom.cellOptions', value: { type: 'color-text' } }, { id: 'thresholds', value: { mode: 'absolute', steps: [{ color: GREEN, value: null }, { color: ORANGE, value: 0.01 }, { color: RED, value: 0.05 }] } }] },
							{ matcher: { id: 'byName', options: 'p50' }, properties: [{ id: 'unit', value: 's' }] },
							{ matcher: { id: 'byName', options: 'p95' }, properties: [{ id: 'unit', value: 's' }, { id: 'custom.cellOptions', value: { type: 'color-text' } }, { id: 'thresholds', value: { mode: 'absolute', steps: [{ color: GREEN, value: null }, { color: ORANGE, value: 1 }, { color: RED, value: 3 }] } }] },
						],
						options: { sortBy: [{ displayName: 'Pages / s', desc: true }], cellHeight: 'sm', showHeader: true },
					},
				],
			},
		],
	},
	{
		title: 'Sources',
		rows: [
			{
				title: 'Calls',
				panels: [
					series({ title: 'Calls / s by Source', unit: 'reqps', stack: true, queries: [q(`sum by (name) (rate(${CALLS}{${SOURCE}}[${R}]))`, '{{name}}')] }),
					series({
						title: 'Calls / s by outcome',
						unit: 'reqps',
						stack: true,
						colors: STATUS_COLORS,
						description: '`error` is a call that failed without an answer, such as a timeout, or whose body failed halfway.',
						queries: [q(`sum by (outcome) (rate(${CALLS}{${SOURCE}}[${R}]))`, '{{outcome}}')],
					}),
					series({
						title: 'Calls / s by method',
						unit: 'reqps',
						stack: true,
						queries: [q(`sum by (name, method) (rate(${CALLS}{${SOURCE}}[${R}]))`, '{{name}} {{method}}')],
					}),
					bars({
						title: 'Calls by type of Source',
						unit: 'reqps',
						width: 12,
						description: 'The `source` label is the type: `gitlab`, `harbor` or `nexus`.',
						queries: [q(`sort_desc(sum by (source) (rate(${CALLS}{${SOURCE}}[$__range])))`, '{{source}}')],
					}),
				],
			},
			{
				title: 'Reliability',
				panels: [
					series({
						title: 'Failure ratio by Source',
						unit: 'percentunit',
						thresholds: [0.01, 0.05],
						description: '5xx and failed calls over all calls.',
						queries: [q(`sum by (name) (rate(${CALLS}{${SOURCE},outcome=~"5xx|error"}[${R}])) / sum by (name) (rate(${CALLS}{${SOURCE}}[${R}]))`, '{{name}}')],
					}),
					bars({
						title: 'Failure ratio over the selected time range',
						unit: 'percentunit',
						thresholds: [0.01, 0.05],
						queries: [q(`sort_desc(sum by (name) (increase(${CALLS}{${SOURCE},outcome=~"5xx|error"}[$__range])) / sum by (name) (increase(${CALLS}{${SOURCE}}[$__range])))`, '{{name}}')],
					}),
					series({
						title: '4xx ratio by Source',
						unit: 'percentunit',
						description: 'Calls refused: a token that expired, a project that does not exist.',
						queries: [q(`sum by (name) (rate(${CALLS}{${SOURCE},outcome="4xx"}[${R}])) / sum by (name) (rate(${CALLS}{${SOURCE}}[${R}]))`, '{{name}}')],
					}),
					series({
						title: 'Failed calls / s by Source and outcome',
						unit: 'reqps',
						stack: true,
						queries: [q(`sum by (name, outcome) (rate(${CALLS}{${SOURCE},outcome=~"5xx|error"}[${R}]))`, '{{name}} {{outcome}}')],
					}),
				],
			},
			{
				title: 'Latency',
				panels: [
					series({ title: 'p95 by Source', unit: 's', queries: [q(quantile(0.95, CALL_DURATION, SOURCE, 'name'), '{{name}}')] }),
					series({ title: 'p50 by Source', unit: 's', queries: [q(quantile(0.5, CALL_DURATION, SOURCE, 'name'), '{{name}}')] }),
					series({
						title: 'p95 by outcome',
						unit: 's',
						description: 'Calls that fail without an answer run until their timeout.',
						queries: [q(quantile(0.95, CALL_DURATION, SOURCE, 'outcome'), '{{outcome}}')],
						colors: STATUS_COLORS,
					}),
					heatmap({ title: 'Call duration distribution', metric: CALL_DURATION, selector: SOURCE }),
				],
			},
			{
				title: 'Cache of the Sources',
				panels: [
					series({
						title: 'Hit ratio by Source',
						unit: 'percentunit',
						thresholds: [0.9, 0.8],
						lowIsBad: true,
						max: 1,
						description: 'Reads of a Source answered from a fresh entry. A miss called the Source.',
						queries: [q(`sum by (name) (rate(${LOOKUPS}{${SOURCE},status="hit"}[${R}])) / sum by (name) (rate(${LOOKUPS}{${SOURCE}}[${R}]))`, '{{name}}')],
					}),
					series({
						title: 'Reads / s by status',
						unit: 'reqps',
						stack: true,
						colors: { hit: 'green', miss: 'orange' },
						queries: [q(`sum by (status) (rate(${LOOKUPS}{${SOURCE}}[${R}]))`, '{{status}}')],
					}),
				],
			},
		],
	},
	{
		title: 'Cache store',
		rows: [
			{
				title: 'Efficiency',
				panels: [
					series({
						title: 'Hit ratio',
						unit: 'percentunit',
						thresholds: [0.9, 0.8],
						lowIsBad: true,
						max: 1,
						queries: [q(`sum by (store) (rate(vitrine_cache_hits_total{${STORE}}[${R}])) / (sum by (store) (rate(vitrine_cache_hits_total{${STORE}}[${R}])) + sum by (store) (rate(vitrine_cache_misses_total{${STORE}}[${R}])))`, '{{store}}')],
					}),
					series({
						title: 'Reads / s',
						unit: 'ops',
						stack: true,
						colors: { hits: 'green', misses: 'orange' },
						queries: [q(`sum(rate(vitrine_cache_hits_total{${STORE}}[${R}]))`, 'hits'), q(`sum(rate(vitrine_cache_misses_total{${STORE}}[${R}]))`, 'misses')],
					}),
				],
			},
			{
				title: 'Size',
				panels: [
					series({
						title: 'Entries',
						unit: 'short',
						description: 'Measured by Vitrine at most every 30 seconds, by each pod. A shared store, such as redis, reads the same from every pod: the lines overlap. A drop to 0 is a flushed store.',
						queries: [q(`max by (store, instance) (vitrine_cache_entries{${STORE}})`, '{{store}} {{instance}}')],
					}),
					series({
						title: 'Bytes',
						unit: 'bytes',
						noValue: 'Not reported by the redis store',
						description: '`memory` and `files` report it, `redis` does not: it takes a command per key.',
						queries: [q(`max by (store, instance) (vitrine_cache_bytes{${STORE}})`, '{{store}} {{instance}}')],
					}),
				],
			},
			{
				title: 'Errors',
				panels: [
					series({
						title: 'Write errors / s',
						unit: 'ops',
						description: 'Writes that failed: the store is down or full, and Visitors pay for it with slower pages.',
						queries: [q(`sum by (store) (rate(vitrine_cache_write_errors_total{${STORE}}[${R}]))`, '{{store}}')],
					}),
					series({
						title: 'Write errors per hour',
						unit: 'short',
						bars: true,
						queries: [q(`sum by (store) (increase(vitrine_cache_write_errors_total{${STORE}}[1h]))`, '{{store}}')],
					}),
				],
			},
		],
	},
	{
		title: 'Warm-up',
		rows: [
			{
				title: 'Runs',
				panels: [
					stat({
						title: 'Runs',
						unit: 'none',
						width: 6,
						description: 'Warm-ups the servers ran over the selected time range: each pod runs its own, so 3 pods run 3 times as many.',
						queries: [q('sum(increase(vitrine_warmup_runs_total[$__range]))')],
					}),
					stat({
						title: 'URLs found / run',
						unit: 'none',
						width: 6,
						queries: [q('sum(increase(vitrine_warmup_urls_found_total[$__range])) / sum(increase(vitrine_warmup_runs_total[$__range]))')],
					}),
					stat({
						title: 'Median duration',
						unit: 's',
						width: 6,
						queries: [q(quantile(0.5, WARMUP_DURATION, '', '', '$__range'))],
					}),
					stat({
						title: 'p95 duration',
						unit: 's',
						width: 6,
						thresholds: [30, 60],
						queries: [q(quantile(0.95, WARMUP_DURATION, '', '', '$__range'))],
					}),
					series({
						title: 'Runs per hour',
						unit: 'short',
						bars: true,
						description: 'Only the warm-ups the servers run from `warmUp` in Settings are measured. Each pod runs its own, so the count is that of all pods.',
						queries: [q(`sum(increase(vitrine_warmup_runs_total[${HOUR}]))`, 'runs')],
					}),
					series({
						title: 'URLs found per run',
						unit: 'short',
						description: 'Distinct URLs of Vitrine that warm-ups saw. A fall is pages that went missing from the Sources.',
						queries: [q(`sum(increase(vitrine_warmup_urls_found_total[${HOUR}])) / sum(increase(vitrine_warmup_runs_total[${HOUR}]))`, 'URLs')],
					}),
				],
			},
			{
				title: 'Duration',
				panels: [
					series({ title: 'Warm-up duration', unit: 's', queries: [0.5, 0.95].map((phi) => q(quantile(phi, WARMUP_DURATION, '', '', HOUR), `p${phi * 100}`)) }),
					series({
						title: 'Average warm-up duration',
						unit: 's',
						queries: [q(`sum(rate(${WARMUP_DURATION}_sum[${HOUR}])) / sum(rate(${WARMUP_DURATION}_count[${HOUR}]))`, 'average')],
					}),
					heatmap({ title: 'Warm-up duration distribution', metric: WARMUP_DURATION, selector: '', window: HOUR, width: 24 }),
				],
			},
			{
				title: 'Problems',
				panels: [
					series({
						title: 'Pages with problems per run',
						unit: 'short',
						thresholds: [5, 20],
						description: 'Pages whose list of problems was not empty. A rise right after a deploy is the deploy; one that follows an outage of a Source is the Source.',
						queries: [q(`sum(increase(vitrine_warmup_pages_with_problems_total[${HOUR}])) / sum(increase(vitrine_warmup_runs_total[${HOUR}]))`, 'pages')],
					}),
					series({
						title: 'Pages with problems per hour',
						unit: 'short',
						bars: true,
						queries: [q(`sum(increase(vitrine_warmup_pages_with_problems_total[${HOUR}]))`, 'pages')],
					}),
				],
			},
		],
	},
	{
		title: 'Node',
		rows: [
			{
				title: 'Process',
				panels: [
					series({
						title: 'CPU by pod',
						unit: 'short',
						description: 'CPU seconds per second: 1 is one core. User and system time, stacked.',
						stack: true,
						queries: [q(`rate(process_cpu_user_seconds_total[${R}])`, '{{instance}} user'), q(`rate(process_cpu_system_seconds_total[${R}])`, '{{instance}} system')],
					}),
					series({
						title: 'Resident memory by pod',
						unit: 'bytes',
						description: 'A line that climbs between two restarts is a leak.',
						queries: [q('process_resident_memory_bytes', '{{instance}}')],
					}),
					series({
						title: 'Heap used by pod',
						unit: 'bytes',
						queries: [q('nodejs_heap_size_used_bytes', '{{instance}}')],
					}),
					series({ title: 'Open file descriptors by pod', unit: 'short', queries: [q('process_open_fds', '{{instance}}')] }),
					series({
						title: 'Event loop lag p99 by pod',
						unit: 's',
						thresholds: [0.05, 0.2],
						description: 'A loop that lags delays every page that pod serves, whatever Route.',
						queries: [q('nodejs_eventloop_lag_p99_seconds', '{{instance}}')],
						width: 24,
					}),
				],
			},
			{
				title: 'Restarts',
				panels: [
					bars({
						title: 'Restarts by pod',
						unit: 'none',
						width: 8,
						description: 'Changes of process_start_time_seconds over the selected time range: a container that restarted inside its pod. A pod that a deploy replaces is a new instance, not a restart.',
						queries: [q('sort_desc(sum by (instance) (changes(process_start_time_seconds[$__range])))', '{{instance}}')],
					}),
					series({
						title: 'Age by pod',
						unit: 's',
						width: 16,
						description: 'Seconds since each process started: it falls back to 0 at a restart, and a new pod starts from 0.',
						queries: [q('time() - process_start_time_seconds', '{{instance}}')],
					}),
					{
						type: 'state-timeline',
						title: 'Scrapes by pod',
						description: '`up`: 0 while Prometheus could not scrape a pod. A pod that a deploy replaces ends its row, and the new one starts another.',
						width: 24,
						height: 6,
						queries: [q('max by (instance) (up{})', '{{instance}}')],
						options: { mergeValues: true, showValue: 'never', rowHeight: 0.8, legend: { showLegend: false } },
					},
				],
			},
		],
	},
	{
		title: 'Logs',
		// The Level and the Search of this tab only: they filter the raw logs.
		scoped: () => [levelVariable(), searchVariable()],
		rows: [
			{
				title: 'Overview',
				panels: [
					stat({ title: 'Log lines', unit: 'short', width: 6, datasource: LOKI, description: 'Lines the selected pods logged over the selected time range.', queries: [q(`sum(count_over_time(${LOGS}[$__range]))`)] }),
					stat({ title: 'Errors', unit: 'short', width: 6, datasource: LOKI, thresholds: [1, 100], queries: [q(`sum(count_over_time(${ERRORS}[$__range]))`)] }),
					stat({ title: 'Warnings', unit: 'short', width: 6, datasource: LOKI, queries: [q(`sum(count_over_time(${WARNINGS}[$__range]))`)] }),
					stat({ title: 'Starts', unit: 'short', width: 6, datasource: LOKI, description: 'Pods that logged `Starting Vitrine`: each deploy, restart or crash.', queries: [q(`sum(count_over_time(${LOGS} |= "Starting Vitrine" [$__range]))`)] }),
					// The same four, one value per pod.
					stat({ title: 'Log lines by instance', unit: 'short', width: 6, height: 8, datasource: LOKI, options: PER_INSTANCE, queries: [q(`sum by (instance) (count_over_time(${LOGS}[$__range]))`, '{{instance}}')] }),
					stat({ title: 'Errors by instance', unit: 'short', width: 6, height: 8, datasource: LOKI, thresholds: [1, 100], options: PER_INSTANCE, queries: [q(`sum by (instance) (count_over_time(${ERRORS}[$__range]))`, '{{instance}}')] }),
					stat({ title: 'Warnings by instance', unit: 'short', width: 6, height: 8, datasource: LOKI, options: PER_INSTANCE, queries: [q(`sum by (instance) (count_over_time(${WARNINGS}[$__range]))`, '{{instance}}')] }),
					stat({
						title: 'Starts by instance',
						unit: 'short',
						width: 6,
						height: 8,
						datasource: LOKI,
						description: 'A pod that a deploy replaces is a new instance; one that crashed and restarted inside its pod logs a start again under the same instance.',
						options: PER_INSTANCE,
						queries: [q(`sum by (instance) (count_over_time(${LOGS} |= "Starting Vitrine" [$__range]))`, '{{instance}}')],
					}),
				],
			},
			{
				title: 'Volume',
				panels: [
					series({
						title: 'Lines per level',
						datasource: LOKI,
						unit: 'short',
						stack: true,
						bars: true,
						colors: { info: 'green', warn: 'yellow', error: 'red' },
						description: 'The level is a label of the stream, so this is cheap to ask even for a week.',
						queries: [q(`sum by (level) (count_over_time(${LOGS}[$__auto]))`, '{{level}}')],
					}),
					series({
						title: 'Errors by message',
						datasource: LOKI,
						unit: 'short',
						stack: true,
						bars: true,
						queries: [q(`sum by (msg) (count_over_time(${ERRORS} | json [$__auto]))`, '{{msg}}')],
					}),
					bars({
						title: 'Most frequent errors over the selected time range',
						datasource: LOKI,
						unit: 'short',
						width: 12,
						queries: [q(`sort_desc(topk(10, sum by (msg) (count_over_time(${ERRORS} | json [$__range]))))`, '{{msg}}')],
					}),
					series({
						title: 'Starts by version',
						datasource: LOKI,
						unit: 'short',
						bars: true,
						stack: true,
						description: '`Starting Vitrine` carries the version: a deploy replaces every pod, a crash restarts one.',
						queries: [q(`sum by (version) (count_over_time(${LOGS} |= "Starting Vitrine" | json [$__auto]))`, '{{version}}')],
					}),
				],
			},
			{
				title: 'Sources, cache and pages, from the logs',
				panels: [
					series({
						title: 'Sources that could not be loaded',
						datasource: LOKI,
						unit: 'short',
						stack: true,
						bars: true,
						description: 'One line per failed read of a Source. The Source is the start of the cache key.',
						queries: [q(`sum by (source) (count_over_time(${ERRORS} |= "Could not load a Source" | json | label_format source=\`{{ regexReplaceAll "/.*" .key "" }}\` [$__auto]))`, '{{source}}')],
					}),
					bars({
						title: 'Why a Source could not be loaded',
						datasource: LOKI,
						unit: 'short',
						description: 'The message of the error of each failed read.',
						queries: [q(`sort_desc(topk(10, sum by (cause) (count_over_time(${ERRORS} |= "Could not load a Source" | json cause="error.message" [$__range]))))`, '{{cause}}')],
					}),
					series({
						title: 'Cache store errors',
						datasource: LOKI,
						unit: 'short',
						stack: true,
						bars: true,
						queries: [q(`sum by (msg) (count_over_time(${ERRORS} |~ "Cache store could not" | json [$__auto]))`, '{{msg}}')],
					}),
					bars({
						title: 'Pages whose Template failed',
						datasource: LOKI,
						unit: 'short',
						description: 'The most frequent paths of `Template failed`.',
						queries: [q(`sort_desc(topk(10, sum by (path) (count_over_time(${ERRORS} |= "Template failed" | json [$__range]))))`, '{{path}}')],
					}),
				],
			},
			{
				title: 'Warm-ups, from the logs',
				panels: [
					series({
						title: 'Pages that failed a warm-up, per hour',
						datasource: LOKI,
						unit: 'short',
						bars: true,
						description: '`Warm-up page failed`, one line per page. The metric `vitrine_warmup_pages_with_problems_total` counts the same pages.',
						queries: [q(`sum(count_over_time(${ERRORS} |= "Warm-up page failed" [${HOUR}]))`, 'pages')],
					}),
					series({
						title: 'Warm-up duration by pod',
						datasource: LOKI,
						unit: 's',
						description: 'The `seconds` of the summary, `Warm-up finished`, of each pod: the longest of each hour.',
						queries: [q(`max by (instance) (max_over_time(${LOGS} |= "Warm-up finished" | json | unwrap seconds | __error__="" [${HOUR}]))`, '{{instance}}')],
					}),
					series({
						title: 'Share of pages that failed a warm-up',
						datasource: LOKI,
						unit: 'percentunit',
						thresholds: [0.02, 0.1],
						queries: [
							q(`sum(sum_over_time(${LOGS} |= "Warm-up finished" | json | unwrap failed | __error__="" [${HOUR}])) / sum(sum_over_time(${LOGS} |= "Warm-up finished" | json | unwrap pages | __error__="" [${HOUR}]))`, 'failed'),
						],
					}),
					bars({
						title: 'Why pages failed a warm-up',
						datasource: LOKI,
						unit: 'short',
						queries: [q(`sort_desc(topk(10, sum by (problem) (count_over_time(${ERRORS} |= "Warm-up page failed" | json problem="problems[0]" [$__range]))))`, '{{problem}}')],
					}),
				],
			},
			{
				title: 'Raw logs',
				panels: [
					{
						type: 'logs',
						title: 'Logs',
						description: 'One JSON object per line, as Vitrine writes them. Level and Search filter them: Search is a regular expression, case-insensitive, such as `gitlab.*503`. Click a line for its fields.',
						datasource: LOKI,
						width: 24,
						height: 20,
						queries: [q(`{job=~"$job",instance=~"$instance",level=~"$level"} |~ "(?i)$search"`)],
					},
				],
			},
		],
	},
];

// ---- Variables.

/** The values of a label, among the series the `job` and `instance` variables select, each by those before it. */
const variable = (name: string, label: string, metric: string, labelName: string) => {
	const selector = name === 'job' ? '' : name === 'instance' ? '{job=~"$job"}' : '{job=~"$job",instance=~"$instance"}';
	const query = `label_values(${metric}${selector},${labelName})`;
	return {
	kind: 'QueryVariable',
	spec: {
		name,
		label,
		current: { text: ['All'], value: ['$__all'] },
		hide: 'dontHide',
		refresh: 'onTimeRangeChanged',
		skipUrlSync: false,
		query: {
			kind: 'DataQuery',
			group: 'prometheus',
			version: 'v0',
			datasource: { name: DATASOURCE },
			spec: { qryType: 5, query, refId: `${name}-variable` },
		},
		definition: query,
		regex: '',
		sort: 'alphabeticalAsc',
		options: [],
		multi: true,
		includeAll: true,
		allValue: '.*',
		allowCustomValue: false,
	},
	};
};

/** Which levels the raw logs show. */
const levelVariable = () => ({
	kind: 'CustomVariable',
	spec: {
		name: 'level',
		label: 'Level',
		query: 'error,warn,info',
		current: { text: ['All'], value: ['$__all'] },
		options: ['error', 'warn', 'info'].map((level) => ({ text: level, value: level, selected: false })),
		multi: true,
		includeAll: true,
		allValue: '.+',
		hide: 'dontHide',
		skipUrlSync: false,
		allowCustomValue: false,
	},
});
/** A regular expression the raw logs must match. */
const searchVariable = () => ({ kind: 'TextVariable', spec: { name: 'search', label: 'Search', query: '', current: { text: '', value: '' }, hide: 'dontHide', skipUrlSync: false } });

// ---- Grafana's v2 schema.

let nextId = 1;
const elements: Record<string, unknown> = {};

function element(panel: Panel): string {
	const id = nextId++;
	const name = `panel-${id}`;
	const colorOverrides = Object.entries(panel.colors ?? {}).map(([series, color]) => ({
		matcher: { id: 'byName', options: series },
		properties: [{ id: 'color', value: { mode: 'fixed', fixedColor: color } }],
	}));
	const steps = panel.thresholds
		? panel.lowIsBad
			? [{ color: RED, value: null }, { color: ORANGE, value: panel.thresholds[1] }, { color: GREEN, value: panel.thresholds[0] }]
			: [{ color: GREEN, value: null }, { color: ORANGE, value: panel.thresholds[0] }, { color: RED, value: panel.thresholds[1] }]
		: [{ color: 'blue', value: null }];
	const timeseriesCustom = {
		drawStyle: panel.bars ? 'bars' : 'line',
		lineWidth: 1,
		fillOpacity: panel.stack || panel.bars ? 30 : 8,
		showPoints: 'never',
		spanNulls: false,
		stacking: { mode: panel.stack ? 'normal' : 'none', group: 'A' },
		thresholdsStyle: { mode: panel.thresholds && panel.type === 'timeseries' ? 'dashed' : 'off' },
	};
	const defaults: Record<string, unknown> = {
		unit: panel.unit,
		min: panel.min ?? (panel.unit === 'percentunit' || panel.unit === 'reqps' || panel.unit === 'ops' ? 0 : undefined),
		max: panel.max,
		noValue: panel.noValue,
		thresholds: { mode: 'absolute', steps },
		custom: panel.type === 'timeseries' ? { ...timeseriesCustom, ...panel.custom } : panel.custom,
		color: panel.type === 'timeseries' || panel.type === 'state-timeline' ? { mode: panel.thresholds && panel.type === 'timeseries' ? 'palette-classic' : 'palette-classic' } : { mode: 'thresholds' },
	};
	const options: Record<string, unknown> =
		panel.type === 'timeseries'
			? { legend: { showLegend: true, displayMode: 'list', placement: 'bottom', calcs: [] }, tooltip: { mode: 'multi', sort: 'desc' } }
			: panel.type === 'stat'
				? { reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false }, colorMode: panel.thresholds ? 'background' : 'value', graphMode: 'none', textMode: 'value' }
				: panel.type === 'bargauge'
					? {
							// An instant query of Loki comes as the rows of one frame, where Prometheus's come as one frame a series: each row is a bar.
							reduceOptions: { calcs: ['lastNotNull'], fields: '', values: panel.datasource === LOKI },
							displayMode: 'gradient',
							orientation: 'horizontal',
							showUnconnectedFill: true,
							valueMode: 'color',
						}
					: panel.type === 'logs'
						? { showTime: true, showLabels: false, showCommonLabels: false, wrapLogMessage: true, prettifyLogMessage: false, enableLogDetails: true, enableInfiniteScrolling: true, sortOrder: 'Descending', dedupStrategy: 'none' }
					: panel.type === 'heatmap'
						? {
								calculate: false,
								yAxis: { axisPlacement: 'left', unit: panel.unit },
								rowsFrame: { layout: 'auto' },
								color: { mode: 'scheme', scheme: 'Spectral', fill: 'dark-orange', scale: 'exponential', exponent: 0.5, steps: 64, reverse: false },
								cellGap: 1,
								legend: { show: true },
								tooltip: { mode: 'single', yHistogram: false },
							}
						: {};
	elements[name] = {
		kind: 'Panel',
		spec: {
			id,
			title: panel.title,
			description: panel.description ?? '',
			links: [],
			data: {
				kind: 'QueryGroup',
				spec: {
					queries: panel.queries.map((query, index) => ({
						kind: 'PanelQuery',
						spec: {
							refId: String.fromCharCode(65 + index),
							hidden: false,
							query: {
								kind: 'DataQuery',
								group: panel.datasource ?? DATASOURCE,
								version: 'v0',
								datasource: { name: panel.datasource ?? DATASOURCE },
								spec:
									panel.datasource === LOKI
										? {
												expr: query.expr,
												legendFormat: query.legend ?? '',
												queryType: query.instant ? 'instant' : 'range',
												editorMode: 'code',
												direction: 'backward',
												maxLines: 1000,
											}
										: {
												expr: withJob(query.expr),
												legendFormat: query.legend ?? '__auto',
												instant: query.instant ?? false,
												range: !query.instant,
												format: query.format ?? 'time_series',
												editorMode: 'code',
											},
							},
						},
					})),
					transformations: (panel.transformations ?? []).map(({ id: group, options: transformation }) => ({ kind: 'Transformation', group, spec: { options: transformation } })),
					queryOptions: {},
				},
			},
			vizConfig: {
				kind: 'VizConfig',
				group: panel.type,
				version: PLUGIN_VERSION,
				spec: { options: { ...options, ...panel.options }, fieldConfig: { defaults, overrides: [...colorOverrides, ...(panel.overrides ?? [])] } },
			},
		},
	};
	return name;
}

/** Panels left to right, wrapping at 24 columns. */
function grid(panels: Panel[]) {
	let x = 0;
	let y = 0;
	let tallest = 0;
	const items = panels.map((panel) => {
		if (x + panel.width > 24) {
			x = 0;
			y += tallest;
			tallest = 0;
		}
		const item = { kind: 'GridLayoutItem', spec: { x, y, width: panel.width, height: panel.height, element: { kind: 'ElementReference', name: element(panel) } } };
		x += panel.width;
		tallest = Math.max(tallest, panel.height);
		return item;
	});
	return { kind: 'GridLayout', spec: { items } };
}

const dashboard = {
	apiVersion: 'dashboard.grafana.app/v2',
	kind: 'Dashboard',
	metadata: { name: 'vitrine' },
	spec: {
		title: 'Vitrine',
		description: 'The metrics of Vitrine, from docs/administrator/metrics.md.',
		tags: ['vitrine'],
		cursorSync: 'Crosshair',
		editable: true,
		liveNow: false,
		preload: false,
		annotations: [
			{
				kind: 'AnnotationQuery',
				spec: {
					name: 'Deploys',
					enable: true,
					hide: false,
					iconColor: 'purple',
					query: {
						kind: 'DataQuery',
						group: 'prometheus',
						version: 'v0',
						datasource: { name: DATASOURCE },
						// A version that appears: present now, absent a step before.
						spec: { expr: withJob('max by (job, version) (vitrine_build_info) unless max by (job, version) (vitrine_build_info offset 10m)'), titleFormat: 'Deployed {{version}} ({{job}})', useValueForTime: false, step: '10m' },
					},
				},
			},
		],
		links: [],
		variables: [
			variable('job', 'Job', 'vitrine_build_info', 'job'),
			variable('instance', 'Instance', 'vitrine_build_info', 'instance'),
			variable('route', 'Route', 'vitrine_http_requests_total', 'route'),
			variable('source_name', 'Source', 'vitrine_source_http_calls_total', 'name'),
			variable('store', 'Cache store', 'vitrine_cache_hits_total', 'store'),
		],
		timeSettings: { from: 'now-7d', to: 'now', timezone: 'browser', autoRefresh: '', autoRefreshIntervals: ['30s', '1m', '5m', '15m', '1h'], hideTimepicker: false, fiscalYearStartMonth: 0 },
		elements,
		layout: {
			kind: 'TabsLayout',
			spec: {
				tabs: tabs.map((tab) => ({
					kind: 'TabsLayoutTab',
					spec: {
						title: tab.title,
						...(tab.scoped ? { variables: tab.scoped() } : {}),
						layout: { kind: 'RowsLayout', spec: { rows: tab.rows.map((row) => ({ kind: 'RowsLayoutRow', spec: { title: row.title, collapse: row.collapse ?? false, layout: grid(row.panels) } })) } },
					},
				})),
			},
		},
	},
};

const target = new URL('./dashboards/vitrine.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(dashboard, null, '\t')}\n`);
console.log(`${nextId - 1} panels in ${tabs.length} tabs, written to ${target.pathname}`);
