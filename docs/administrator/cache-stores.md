# Cache stores

Vitrine reads its Sources when a Visitor opens a page, not on a schedule. Content younger than the `allowedAgeMinutes` of its Source, 15 by default, is served from the cache store without asking the Source. Older content is read again. When the Source is down, or takes more than 10 seconds, Vitrine serves the Stale content it still has, with a warning, so that a Source outage does not empty the page. When the Source answers but no longer has the content, as when Epics are not on its tier, Vitrine shows that answer instead. Search answers from the same cached lists, so it costs the Sources nothing while they are fresh.

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

The simplest store, and the right one for a single replica that may restart with an empty cache. After a restart, the first Visitor of each page waits for its Source, and an outage just after a restart has no Stale content to fall back on. Entries are never removed, only replaced, so memory grows with the number of distinct pages Visitors open.

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
