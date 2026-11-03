# Components

A Component is a self-contained part of a page. It reads its own content from one Source, through the cache, and shows its own warnings and errors: a note when its content is Stale because the Source is down, and an alert when it could not be loaded at all. One Component failing never stops the rest of the page.

Every Component is in `src/components`, and you use one in two ways.

## Using a Component

### In a Template

A Template in Settings places Components with no import, under their file name, and startup checks their props: see [Templates](templates.md).

```yaml
routes:
  - url: /overview
    controller: gitlab-group
    params:
      group: platform
    template: |
      <GitlabGroupSummary source={source} group={group} />
      <GitlabProjectList source={source} group={group} />
```

### On a page of a fork

A Template cannot import files, add a Controller or set a status code. To go further, fork Vitrine and add an Astro page to `src/pages`. A page there wins over the Routes of Settings at the same URL. Import each Component, and the Layout for the Branding, Menu and Theme of every other page:

```astro
---
// src/pages/platform-images.astro
import ImageList from '../components/ImageList.astro';
import GitlabReleaseList from '../components/GitlabReleaseList.astro';
import Layout from '../layouts/Layout.astro';
---

<Layout title="Platform images">
	<h1>Platform images</h1>
	<ImageList source="main-harbor" project="platform" />
	<GitlabReleaseList source="main-gitlab" project="platform/api" />
</Layout>
```

Each `source` is the `name` of a Source in Settings. On a page of a fork, nothing checks props at startup: a mistake shows when the page is opened, and `npm run build` catches what TypeScript can. The Container image builds `src/pages` in, so build your own Container image from the fork with `docker build --file Containerfile .` or `podman build .`.

Props marked required must be given. The others have the defaults below.

## `GitlabCommitList`

The latest commits of a Project's default branch, with their author and date.

| Prop | Required | What it does |
| --- | --- | --- |
| `source` | yes | The GitLab Source. |
| `project` | yes | The full Project path, such as `platform/api`. |

## `GitlabContributorList`

The people who committed most to a Project, with their avatar. Their emails are not shown.

| Prop | Required | What it does |
| --- | --- | --- |
| `source` | yes | The GitLab Source. |
| `project` | yes | The full Project path. |

## `GitlabEpics`

The open Epics of a Main Group and of everything beneath it, as a list, with their description, assignees, weight and Issues. Epics need GitLab 18.1 or later on a tier that includes them.

| Prop | Required | What it does |
| --- | --- | --- |
| `source` | yes | The GitLab Source. |
| `group` | yes | A Main Group, as Epics are read per Main Group. Any other Group shows an alert. |

## `GitlabGroupIssues`

The open, non-confidential Issues of a Group and of everything beneath it, with their Project, assignees and labels.

| Prop | Required | What it does |
| --- | --- | --- |
| `source` | yes | The GitLab Source. |
| `group` | yes | The Group path. |

## `GitlabGroupList`

The Main Groups of a Source, or the subgroups of one Group, each linked to its Group, Issues and Roadmap pages where Routes offer them.

| Prop | Required | What it does |
| --- | --- | --- |
| `source` | yes | The GitLab Source. |
| `group` | no | The Group whose subgroups to list. Left out, the list shows the Main Groups of the Source. |
| `title` | no | The heading. Defaults to Main Groups or Subgroups. An empty `title` leaves the heading out, for a page that heads the list itself. |
| `maxItems` | no | How many Groups to show. Left out, all of them. |

## `GitlabGroupReleases`

The latest Releases of every Project of a Group and beneath it, newest first, each linked to its Project page where a Route offers one.

| Prop | Required | What it does |
| --- | --- | --- |
| `source` | yes | The GitLab Source. |
| `group` | yes | The Group path. |
| `title` | no | The heading. Defaults to Releases. Empty, the heading is left out. |
| `maxItems` | no | How many Releases to show. Left out, all of them. |

## `GitlabGroupSummary`

The name and description of a Group, as the heading of a page.

| Prop | Required | What it does |
| --- | --- | --- |
| `source` | yes | The GitLab Source. |
| `group` | yes | The Group path. |

## `GitlabProjectIssues`

The latest open, non-confidential Issues of a Project, with their assignees and labels.

| Prop | Required | What it does |
| --- | --- | --- |
| `source` | yes | The GitLab Source. |
| `project` | yes | The full Project path. |

## `GitlabProjectList`

The Projects of a Group and of everything beneath it, archived ones left out, as cards with their description, latest activity and main contributors, each linked to its Project page where a Route offers one.

| Prop | Required | What it does |
| --- | --- | --- |
| `source` | yes | The GitLab Source. |
| `group` | yes | The Group path. |

## `GitlabProjectSummary`

The name, description and latest activity of a Project, as the heading of a page.

| Prop | Required | What it does |
| --- | --- | --- |
| `source` | yes | The GitLab Source. |
| `project` | yes | The full Project path. |

## `GitlabReadme`

A Project's Markdown README, rendered as HTML with anything executable removed, its relative links and images pointing at GitLab.

| Prop | Required | What it does |
| --- | --- | --- |
| `source` | yes | The GitLab Source. |
| `project` | yes | The full Project path. |

## `GitlabReleaseList`

The latest Releases of a Project, newest first.

| Prop | Required | What it does |
| --- | --- | --- |
| `source` | yes | The GitLab Source. |
| `project` | yes | The full Project path. |

## `GroupMembers`

The Members of a Group, with their avatar, location and the public email of their GitLab profile.

| Prop | Required | What it does |
| --- | --- | --- |
| `source` | yes | The GitLab Source. |
| `group` | yes | The Group path. |
| `deep` | no | `true` also lists the Members of every Group and Project beneath it, at one request to GitLab each. Defaults to `false`. |
| `title` | no | The heading. Defaults to Members. Empty, the heading is left out. |
| `maxItems` | no | How many Members to show. Left out, all of them. |

## `GroupRoadmap`

The open Epics of a Main Group and of everything beneath it on a timeline by month, with those without dates set apart.

| Prop | Required | What it does |
| --- | --- | --- |
| `source` | yes | The GitLab Source. |
| `group` | yes | A Main Group, as there is one Roadmap per Main Group. Any other Group shows an alert. |

## `HarborProjectList`

Harbor projects with their creation date and storage used, each linked to its Images where a Route offers them.

| Prop | Required | What it does |
| --- | --- | --- |
| `source` | yes | The Harbor Source. |
| `projects` | no | The names of the Harbor projects to show. Left out, every Harbor project the Source reports, whatever `projects` select in Settings. |
| `maxItems` | no | How many Harbor projects to show. Left out, all of them. |

## `ImageList`

The Images of one Harbor project, with each tag, its size, when it was pushed, and the critical, high, medium and low vulnerabilities of its latest scan.

| Prop | Required | What it does |
| --- | --- | --- |
| `source` | yes | The Harbor Source. |
| `project` | yes | The Harbor project, selected under `projects` in Settings or not. |

## `NexusRepositoryList`

The Published Repositories of a Nexus Source, with their format and type, each linked to its page in Nexus.

| Prop | Required | What it does |
| --- | --- | --- |
| `source` | yes | The Nexus Source. |
| `maxItems` | no | How many Repositories to show. Left out, all of them. |
