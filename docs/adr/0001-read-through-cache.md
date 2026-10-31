# Read Sources through a cache at request time

When a Visitor opens a page, Vitrine serves cached data if it is fresh, and otherwise calls the Source and caches the result. If the Source is down, Vitrine serves the stale data with a warning. We chose this over a scheduled task that writes JSON files for the website to read, because it stays simpler and data is only collected when someone asks for it.

## Consequences

- Vitrine is a server application holding Source credentials, not a static site.
- A Visitor who hits missing or stale data waits for the Source to respond.
- Stale data must survive until it can be replaced, or there is nothing to fall back on during an outage.
- The Administrator chooses memory, local files or Redis as the cache store. Memory loses everything on restart, and only Redis can be shared between replicas.
