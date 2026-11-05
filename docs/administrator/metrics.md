# Metrics

Vitrine serves Prometheus metrics at `GET /metrics`, in Prometheus text format, on the same port as its pages. They show how well the cache works, how long warm-ups take, how slow the Sources are, and how long pages take to render.

## Endpoint

- `metrics.enabled` in Settings, `true` by default. With `false`, `/metrics` is not served and answers 404.
- A Route at `/metrics` stops startup while `metrics.enabled` is `true`, as Vitrine serves that URL itself.
- `METRICS_TOKEN`, an environment variable. When it is set, a request without the header `Authorization: Bearer <token>` gets `401` with `WWW-Authenticate: Bearer`. When it is empty or unset, the endpoint is open. See [Security](security.md#metrics).
- `METRICS_BUCKETS`, an environment variable: the buckets of every histogram, in seconds, ascending and separated by commas. It defaults to `0.1, 0.5, 1, 5, 10, 30`. An invalid value, such as `5,1` or `fast`, stops startup with an error.

On Kubernetes, the [Helm chart](../../charts/vitrine/README.md#metrics) renders a Prometheus Operator `ServiceMonitor`.

## Cache

Labelled with `store`: `memory`, `files` or `redis`.

| Metric | Type | What it counts |
| --- | --- | --- |
| `vitrine_cache_entries` | gauge | Entries the store holds, measured on each scrape. `files` counts the entries in its directory, and `redis` the keys under its `keyPrefix`. |
| `vitrine_cache_bytes` | gauge | Their size in bytes, measured on each scrape. `memory` sums the JSON length of its entries. |
| `vitrine_cache_hits_total` | counter | Reads that found an entry, fresh or Stale. |
| `vitrine_cache_misses_total` | counter | Reads that found no entry, or failed. |
| `vitrine_cache_write_errors_total` | counter | Writes that failed. |

## Source cache

Labelled with `source` (`gitlab`, `harbor` or `nexus`) and `status`: `hit` or `miss`.

| Metric | Type | What it counts |
| --- | --- | --- |
| `vitrine_source_cache_lookups_total` | counter | Reads of a Source through the cache. A `hit` was answered from a fresh entry. A `miss` called the Source, because the entry was missing or too old, or because `allowedAgeMinutes` is `0`. Visitors reading the same content at once share one read, which counts once. |

## Warm-up

Only the warm-ups the server runs from `warmUp` in Settings are measured, not those of `npm run warm-up`.

| Metric | Type | What it counts |
| --- | --- | --- |
| `vitrine_warmup_runs_total` | counter | Warm-ups run. |
| `vitrine_warmup_duration_seconds` | histogram | How long each took. |
| `vitrine_warmup_urls_found_total` | counter | Distinct URLs of Vitrine that warm-ups saw. |
| `vitrine_warmup_pages_with_problems` | counter | Pages whose list of problems was not empty. |

## Source HTTP calls

Labelled with `source` (`gitlab`, `harbor` or `nexus`), `method` and `outcome`: `2xx`, `3xx`, `4xx`, `5xx`, or `error` for a call that failed without an answer, such as a timeout. The path is not a label.

| Metric | Type | What it counts |
| --- | --- | --- |
| `vitrine_source_http_calls_total` | counter | Calls to a Source. |
| `vitrine_source_http_call_duration_seconds` | histogram | How long the Source took to answer. |

## Rendering and Node

| Metric | Type | What it counts |
| --- | --- | --- |
| `vitrine_render_duration_seconds` | histogram | How long a page took to render, labelled with `route`: the URL of its Route in Settings, such as `/nexus/:source`, never the URL requested. A page with a Template is timed until it is complete; any other page streams, so it is timed until its response starts. |

The default Node process metrics of `prom-client` are served too, such as `process_cpu_user_seconds_total` and `nodejs_eventloop_lag_seconds`.
