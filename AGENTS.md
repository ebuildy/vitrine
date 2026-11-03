## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

Commit with `git commit -s`, amends included: the sign-off respects the DCO.

Typecheck with `npm run check`, as CI does: it runs `astro sync` first, which bare `tsc` needs in a fresh worktree.

`npm test` needs the Redis from `compose.yaml`: run `docker compose up -d --wait` first. It also needs a Docker engine with BuildKit, for `docker build --output`, and `helm` with network access, to render the chart and fetch its Valkey dependency into a Helm home of its own.

A change under `charts/` runs `.github/workflows/chart.yaml`: `helm lint`, kubeconform and a Trivy scan with the default values and each set of `charts/vitrine/ci/`, then an install on kind with the Container image of the chart's `appVersion`. The chart has a version of its own, apart from Vitrine's: a pull request that changes what it ships raises `version` in `charts/vitrine/Chart.yaml`, or the workflow goes red, and `main` publishes that version, once, at `oci://ghcr.io/<owner>/charts/vitrine`. Tags are the Container image's. Add a set there for a new feature of the chart, and accept a Trivy finding only in `charts/vitrine/.trivyignore.yaml`, with why.

`npm test` and `npm run test:e2e` also write an HTML report, to `vitest-report/` and `playwright-report/` (with traces of failed tests), and never open a browser. `npm run test:report` and `npm run test:e2e:report` serve them, each on a free port.

To see a page with content, run `npm run demo`: it serves fake Sources to `astro dev` in the foreground, with `demo/settings.yaml` instead of `settings.yaml`. Seed data lives in `demo/content.ts`.

### Several worktrees at once

`npm run dev`, `npm run demo` and `npm test` run side by side in several worktrees:

- Each `astro dev` takes the next free port from 4321 and prints the URL it serves on. Its `--background` lock lives in its own worktree, so `astro dev status` gives that worktree's URL.
- The demo's fake Sources listen on free ports, printed at start. `demo/start.ts` writes `demo/settings.yaml` with those URLs to `demo/.settings-<pid>.yaml`, which git ignores and the run deletes at exit: edit `demo/settings.yaml`.
- Every worktree shares the one Valkey of `compose.yaml`. A worktree whose Settings use `cacheStore: redis` sets a `keyPrefix` of its own, such as `vitrine-<worktree>:`, so it reads only its own content. Tests give every Redis test a prefix of its own.

## Releases

release-please makes releases from commit messages, so write them as Conventional Commits: `feat:` bumps the minor version, `fix:` the patch. A change an Administrator must act on is breaking, written `feat!:` or with a `BREAKING CHANGE:` footer that says what to do: a renamed or removed Settings option, Controller, param, Component, prop or environment variable, or a new required one. Before `1.0.0`, a breaking change bumps the minor version.

Never bump `package.json`, edit `CHANGELOG.md` or push a `v*` tag by hand. Every push to `main` updates one Release PR. Merging it tags `vX.Y.Z` and creates the GitHub Release, and the tag makes `image.yaml` publish the Container image as `X.Y.Z`, `X.Y` and `X`.

`release.yaml` runs with the repository secret `RELEASE_PLEASE_TOKEN`, a fine-grained personal access token: with `GITHUB_TOKEN` instead, the tag would not trigger `image.yaml`. [`CONTRIBUTING.md`](CONTRIBUTING.md#setting-up-the-repository) explains how to create it and set up the repository, and stays current with `release.yaml`, `image.yaml` and `release-please-config.json`.

## Administrator documentation

Keep it current: every change an Administrator would notice ships with its documentation, in the same commit.

- A Settings option: `settings.example.yaml`
- A Controller or its params: `docs/administrator/controllers.md`
- A Component or its props: `docs/administrator/components.md`
- What a Template can use, or what startup checks: `docs/administrator/templates.md`
- A cache store: `docs/administrator/cache-stores.md`
- What Visitors see, or what credentials read: `docs/administrator/security.md`
- Deployment, the Container image or an environment variable: `README.md`
- A value of the Helm chart: `charts/vitrine/README.md`

`tests/documentation.test.ts` goes red on a missing option, Controller, param, Component, prop or value of the Helm chart, and on a word `GLOSSARY.md` says to avoid. A description that no longer matches the code passes it, so reread the section of whatever you changed.

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
