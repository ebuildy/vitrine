# Vitrine

## Local demo

The demo needs no GitLab, Harbor or Redis: it starts fake Sources filled with `demo/content.ts`, then the dev server.

```sh
npm install
cp .env.example .env
npm run demo
```

Open the URL Astro prints. `/`, `/images`, `/images/tools`, `/harbor/main-harbor`, `/gitlab/data/analytics`, `/issues/platform` and `/roadmap/platform` all show content, and `/roadmap/data/analytics` shows the error of a GitLab tier without Epics. Links to GitLab itself lead to the fake one, which answers 404.

## Secrets

Vitrine reads `.env` from its working directory at start, with `npm run dev` as with `npm start`, and works without one. A variable the environment already sets wins, and `VITRINE_ENV_FILE` names another file. Restart after changing it. `.env` is ignored by git, and `.env.example` lists the variables.

## Container image

`ghcr.io/ebuildy/vitrine` runs from a Settings file mounted at `/etc/vitrine/settings.yaml`, such as a Kubernetes ConfigMap, with secrets in environment variables. It holds no Settings of its own and stops with a clear error without one.

```sh
docker run -p 8080:8080 \
  -v "$PWD/settings.yaml:/etc/vitrine/settings.yaml:ro" \
  -e GITLAB_TOKEN -e HARBOR_PASSWORD \
  ghcr.io/ebuildy/vitrine:edge
```

Two kinds of tag exist, for `linux/amd64` and `linux/arm64`: `edge` follows `main`, and a release `v1.2.3` is published as `1.2.3`, `1.2` and `1`. There is no `latest`.

The image listens on port 8080, as user `node` (uid 1000). It creates no directory for a `files` cache store, so mount a writable one for that user. `src/pages` is built in: to change pages, fork and build your own image from the `Dockerfile`.

# Astro Starter Kit: Basics

```sh
npm create astro@latest -- --template basics
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
│   └── favicon.svg
├── src
│   ├── assets
│   │   └── astro.svg
│   ├── components
│   │   └── Welcome.astro
│   ├── layouts
│   │   └── Layout.astro
│   └── pages
│       └── index.astro
└── package.json
```

To learn more about the folder structure of an Astro project, refer to [our guide on project structure](https://docs.astro.build/en/basics/project-structure/).

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
