# Cache stores

Vitrine reads its Sources when a page is opened, by a Visitor or a [warm-up](#warm-up). Content younger than the `allowedAgeMinutes` of its Source, 15 by default, is served from the cache store without asking the Source. Older content is read again. When the Source is down, or takes more than 10 seconds, Vitrine serves the Stale content it still has, with a warning, so that a Source outage does not empty the page. When the Source answers but no longer has the content, as when Epics are not on its tier, Vitrine shows that answer instead. Search answers from the same cached lists, so it costs the Sources nothing while they are fresh.

`allowedAgeMinutes: 0` leaves the cache out for that Source: every page reads it, nothing is kept, and an outage shows an error instead of Stale content.

The cache store is set once, under `cacheStore` in Settings. Every Source shares it.

| | `memory`, the default | `files` | `redis` |
| --- | --- | --- | --- |
| Survives a restart | no | yes, on a persistent volume | yes, if the server persists its data |
| Shared by replicas | no | no | yes |
| Needs | nothing | a writable directory | a Redis or Valkey server |
| Stale content during an outage | only what this process read since it started | what this replica wrote, for as long as the files stay | what any replica wrote, unless the server evicted it |

## `memory`

```yaml
cacheStore:
  type: memory
```

The simplest store, and the right one for a single replica that may restart with an empty cache. After a restart, the first Visitor of each page waits for its Source unless a warm-up ran first, and an outage just after a restart has no Stale content to fall back on. Entries are never removed, only replaced, so memory grows with the number of distinct pages Visitors open.

## `files`

```yaml
cacheStore:
  type: files
  directory: /var/cache/vitrine
```

One JSON file per entry, written so that a crash never leaves half a file. Content survives a restart when `directory` is on a persistent volume, such as a Kubernetes PersistentVolumeClaim. Nothing removes old files, so give the volume room, or clear it while Vitrine is stopped.

The Container image creates no directory, so mount a writable one for uid 1000. Replicas must not share one directory over a network file system: each replica writes its own.

## `redis`

```yaml
cacheStore:
  type: redis
  urlEnv: REDIS_URL
  keyPrefix: vitrine:
```

The only store that replicas share, so a page one replica read is fresh for the others, and a Source is read once per allowed age, not once per replica. Settings name the environment variable holding the connection URL, as in `REDIS_URL=redis://:password@redis:6379/0`, never the URL itself. Valkey works as well.

- Stale content survives only if the server never loses it. Turn on persistence, with RDB or AOF, and set `maxmemory-policy noeviction`, or an outage may find nothing to fall back on.
- Installations sharing one server each need their own `keyPrefix`, which defaults to `vitrine:`, or they read each other's content.
- When Redis is down or slow, Vitrine waits at most a second for it, then reads the Source as if the cache were empty. Pages still work, but each one reads its Sources.

## Warm-up

A warm-up crawls Vitrine as a Visitor would, so that each page reads its Sources and fills the cache store, and the first Visitor waits on none. It follows the links of each page to Vitrine itself, never to a Source or another site, leaves out links with a query, such as those of search, and visits each page once. It loads only what is missing or older than its allowed age, so a page whose content is fresh costs the Sources nothing, and it cannot reload fresh content.

`warmUp` in Settings runs one inside `npm start` and the Container image, off by default:

```yaml
warmUp:
  atStart: true     # once the server answers, without delaying it
  everyMinutes: 60  # again on this interval, left out for none
  concurrency: 4    # pages requested at once, 4 by default
```

It starts from every Route with a fixed URL, every Menu link and every page of `/sitemap.xml`, and logs a report: a line per page, then how many it visited, how many failed and how long it took. `npm run dev` runs none. With `SERVER_CERT_PATH`, the server crawls `https://127.0.0.1`, so the certificate must hold that address.

`npm run warm-up -- <base URL> [path...] [--concurrency N]`, or `node warm-up.ts` in the Container image, does the same from outside, as a cron. It reads no Settings, so it starts from `/`, or the paths given, and from `/sitemap.xml`. It exits with 1 when a page failed and with 2 on wrong arguments.

A page fails when it does not answer with status 200, or when it shows an alert, such as a Source that is down, Stale content, or Epics that a GitLab tier does not include. The warm-up carries on with the other pages.

## `/sitemap.xml`

Vitrine serves a [sitemap](https://www.sitemaps.org/protocol.html) listing every page that answered with status 200, to a Visitor or a warm-up, with the time of its last visit as `lastmod`, and without its query. A page visited again within a minute keeps its time, so that a busy page does not write to the store on every request. A page that answers 404 leaves the sitemap, so warm-ups stop visiting it. It lives in the cache store, so it lasts as long as the store's content does, and replicas sharing Redis share it. Its addresses use the host the request asked for, and `https` behind a proxy that sets `X-Forwarded-Proto: https`.
