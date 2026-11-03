# Vitrine

A portal that DevOps teams put in front of their GitLab, Harbor and Nexus, so that people can browse content, find it and go to where it can be downloaded. Vitrine shows Groups, Projects, Releases, Issues, Epics, Members, Images and Repositories from one search box and a few pages, and links each one to its Source. It never mirrors a package or an Image.

You configure it with one Settings file, change its look with a Theme and Templates, and fork it to change what Settings cannot.

## Documentation

- [`settings.example.yaml`](settings.example.yaml): every option of Settings, explained, to copy as `settings.yaml`.
- [Controllers](docs/administrator/controllers.md): the kinds of page a Route can show, and their params.
- [Components](docs/administrator/components.md): what a Template or a page of a fork places on a page, and their props.
- [Templates](docs/administrator/templates.md): rearranging a page from Settings.
- [Cache stores](docs/administrator/cache-stores.md): memory, local files or Redis, warm-ups and `/sitemap.xml`.
- [Security](docs/administrator/security.md): **read before you deploy**. Token permissions are the real boundary around private projects, and an installation exposed to the internet shows Member emails, Issue assignments and vulnerability counts to anyone.
- [`GLOSSARY.md`](GLOSSARY.md): the words these documents use, and [`docs/adr`](docs/adr): the decisions behind them.

## Deploy the Container image

`ghcr.io/ebuildy/vitrine` runs from a Settings file mounted at `/etc/vitrine/settings.yaml`, such as a Kubernetes ConfigMap, with secrets in environment variables, such as a Kubernetes Secret. It holds no Settings of its own and stops with a clear error without one.

```sh
docker run -p 8080:8080 \
  -v "$PWD/settings.yaml:/etc/vitrine/settings.yaml:ro" \
  -e GITLAB_TOKEN -e HARBOR_PASSWORD -e NEXUS_PASSWORD \
  ghcr.io/ebuildy/vitrine:edge
```

Two kinds of tag exist, for `linux/amd64` and `linux/arm64`: `edge` follows `main`, and a release `v1.2.3` is published as `1.2.3`, `1.2` and `1`. There is no `latest`.

The Container image listens on port 8080, as user `node` (uid 1000), and stops within 5 seconds of `SIGTERM`, letting requests in progress finish. It creates no directory for a `files` cache store, so mount a writable one for that user. It serves no files of its own: host a logo or a stylesheet elsewhere, or put CSS files beside Settings, in the same ConfigMap.

Startup checks Settings before serving anything, and stops with a list of problems: first a misspelt or misplaced option, then, once Settings read correctly, a Route to a Source that does not exist, a missing environment variable or a Template that does not compile.

### Environment variables

| Variable | What it does |
| --- | --- |
| `VITRINE_SETTINGS` | The Settings file. Defaults to `settings.yaml` in the working directory, and to `/etc/vitrine/settings.yaml` in the Container image. |
| `VITRINE_ENV_FILE` | A file of environment variables read at start. Defaults to `.env` in the working directory. Vitrine works without one, and a variable the environment already sets wins. |
| `VITRINE_TEMPLATE_DISABLE` | Any non-empty value, even `false`, stops Templates from being compiled or run. |
| `HOST`, `PORT` | Where the server listens. The Container image sets `0.0.0.0` and `8080`. |
| Those Settings name | Each `tokenEnv`, `passwordEnv` and `urlEnv` in Settings names a variable holding a secret. Startup stops when one is not set. |

### Cache warm-up

A warm-up crawls Vitrine's pages so that the cache holds their content before the first Visitor comes, as [Cache stores](docs/administrator/cache-stores.md#warm-up) explains. `warmUp` in Settings runs one inside the server. To run one from outside, such as from a Kubernetes CronJob, run the Container image's `warm-up.ts` against a running Vitrine:

```sh
docker run --rm ghcr.io/ebuildy/vitrine:edge node warm-up.ts https://vitrine.example.com --concurrency 4
```

It exits with 1 when a page failed, so that the CronJob shows it, and with 2 on wrong arguments.

## Run from source

Vitrine needs Node.js 22.23.4 or later.

```sh
npm ci
cp settings.example.yaml settings.yaml   # then edit it
cp .env.example .env                     # then put your secrets in it
npm run build
npm start
```

`settings.yaml` and `.env` are ignored by git: never commit real hostnames or secrets. Restart after changing either.

## Fork

Settings change the Sources, Routes, Branding, Menu, Theme and Templates. To add a page, a Controller or a Component, fork Vitrine: a page in `src/pages` wins over the Routes of Settings at the same URL, and can place any Component, as [Components](docs/administrator/components.md#on-a-page-of-a-fork) shows. Then build your own Container image with `podman build .` or `docker build --file Containerfile .`.

## Develop

The demo needs no GitLab, Harbor, Nexus or Redis: it starts fake Sources filled with `demo/content.ts`, then the dev server, with `demo/settings.yaml`.

```sh
npm ci
cp .env.example .env
npm run demo
```

Open the URL Astro prints. `/`, `/images`, `/images/tools`, `/harbor/main-harbor`, `/gitlab/data/analytics`, `/issues/platform`, `/roadmap/platform`, `/search?q=api` and `/nexus/main-nexus` all show content, and `/roadmap/data/analytics` shows the error of a GitLab tier without Epics. Links to GitLab and Nexus themselves lead to the fake ones, which answer 404.

`npm test` needs the Valkey of `compose.yaml`, so run `docker compose up -d --wait` first, and a Docker engine with BuildKit. `npm run test:e2e` runs the browser tests. See [`AGENTS.md`](AGENTS.md) for working in several worktrees at once.

## License

[MIT](LICENSE)
