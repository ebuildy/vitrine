## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

Commit with `git commit -s`, amends included: the sign-off respects the DCO.

`npm test` needs the Redis from `compose.yaml`: run `docker compose up -d --wait` first. It also needs a Docker engine with BuildKit, for `docker build --output`.

To see a page with content, run `npm run demo`: it serves fake Sources to `astro dev` in the foreground, with `demo/settings.yaml` instead of `settings.yaml`. Seed data lives in `demo/content.ts`.

### Several worktrees at once

`npm run dev`, `npm run demo` and `npm test` run side by side in several worktrees:

- Each `astro dev` takes the next free port from 4321 and prints the URL it serves on. Its `--background` lock lives in its own worktree, so `astro dev status` gives that worktree's URL.
- The demo's fake Sources listen on free ports, printed at start. `demo/start.ts` writes `demo/settings.yaml` with those URLs to `demo/.settings.yaml`, which git ignores: edit `demo/settings.yaml`.
- Every worktree shares the one Valkey of `compose.yaml`. A worktree whose Settings use `cacheStore: redis` sets a `keyPrefix` of its own, such as `vitrine-<worktree>:`, so it reads only its own content. Tests give every Redis test a prefix of its own.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `ebuildy/vitrine`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
