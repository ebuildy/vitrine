# Define Routes in Settings instead of file-based routing

Vitrine uses one catch-all Astro page that reads Routes from Settings and hands each URL to a built-in Controller, instead of relying on Astro's file-based routing. This lets an Administrator choose URLs, and point the same Controller at different Sources, without forking.

## Consequences

- A new kind of Controller still requires a fork.
- Pages a fork adds under `src/pages/` take priority over Routes, because Astro prefers fixed paths over a catch-all.
