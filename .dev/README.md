# Dashboard for Vitrine's metrics and logs

Prometheus, Loki and Grafana 13 for local work on the [metrics](../docs/administrator/metrics.md) and the logs:

```sh
docker compose -f .dev/compose.yaml up -d --wait
```

- Grafana: <http://localhost:3000/d/vitrine> (no login). Tabs: Overview, Pages, Sources, Cache store, Warm-up, Node, Logs.
- Prometheus: <http://localhost:9090>
- Loki: <http://localhost:3100>

The first start backfills **7 days of fake metrics and logs** (about a minute), ending now, with a story to look at: **three pods** behind one Service, each with an address of its own; a rolling deploy to a bad release (0.5.0) whose second pod crashes twice, then its hotfix; a flushed Redis; a GitLab outage; a flaky `staging-nexus`. `down -v` forgets everything, and the next `up` backfills anew.

`backfill/generate.ts` makes them by playing events through the real code of the repository, so it needs `npm install` to have run:

- the metrics go through `src/metrics.ts`, and its registry is scraped every 3 minutes, as Prometheus would. `promtool tsdb create-blocks-from` loads them into Prometheus;
- the logs go through `src/logger.mjs`, for the same events: a Source that fails is a metric and a log line. `backfill/push-logs.ts` pushes them to Loki, with the labels `job`, `instance` and `level` that a collector such as Grafana Alloy would give the logs of a pod.

Prometheus also scrapes a Vitrine running on the host (`npm run demo`): put the port it prints in `prometheus/targets.yml`. It shows up as a fourth instance. Its logs are not collected: Loki holds the fake ones only.

The **Job** and **Instance** variables filter every panel, the logs too: Job for several installations, Instance for the pods of one (leave both on All for the whole fleet). A pod that a deploy replaces is a new instance, as on Kubernetes. The Logs tab has a Level and a Search of its own, for the raw logs.

## Changing the dashboard

The dashboard uses Grafana's v2 schema, the one with tabs and rows. Edit `grafana/build-dashboard.ts`, then:

```sh
node .dev/grafana/build-dashboard.ts
docker compose -f .dev/compose.yaml up -d dashboards
```

`grafana/dashboards/vitrine.json` is generated and committed. Changes made in the Grafana UI are overwritten at the next `up`: export the JSON and port them to the builder.

The fake metrics and logs follow `src/metrics.ts` and `src/logger.mjs` by themselves, as they come from that code: a new metric appears once `backfill/generate.ts` plays the events that feed it, and a new message once it logs it where `src/` does. The panels that graph them go in `grafana/build-dashboard.ts`, with `docs/administrator/metrics.md`. Only the Node process metrics are made up in the generator, as they are those of the library, not of Vitrine's code.

## Notes

- Loki runs without a write-ahead log, which stops writes when the disk of Docker is more than 90% full, and is told to flush the old logs at once: queries about logs older than 3 hours do not look at what the ingester still holds.
- The two big files of the backfill, in OpenMetrics and in tab-separated text, are removed once loaded.
