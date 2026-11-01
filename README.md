# Vitrine

## Local demo

The demo needs no GitLab, Harbor or Redis: it starts fake Sources filled with `demo/content.ts`, then the dev server.

```sh
npm install
cp .env.example .env
npm run demo
```

Open the URL Astro prints. `/`, `/images`, `/images/tools`, `/harbor/main-harbor`, `/gitlab/data/analytics` and `/roadmap/platform` all show content, and `/roadmap/data/analytics` shows the error of a GitLab tier without Epics. Links to GitLab itself lead to the fake one, which answers 404.

## Secrets

Vitrine reads `.env` from its working directory at start, with `npm run dev` as with `npm start`, and works without one. A variable the environment already sets wins, and `VITRINE_ENV_FILE` names another file. Restart after changing it. `.env` is ignored by git, and `.env.example` lists the variables.

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
