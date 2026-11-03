# Templates

A Template rearranges what a Controller shows inside the page, on any Route, with no fork and no rebuild. It is Astro markup written in Settings, compiled when Vitrine starts, so a change needs a restart. The Controller keeps not found, the "could not be loaded" page, the page title and `<head>`.

```yaml
routes:
  - url: /overview
    controller: gitlab-group
    params:
      group: platform
    template: |
      ---
      const highlighted = ['platform/backend', 'platform/frontend'];
      ---
      <h1 class="overview">{title}</h1>
      <GitlabProjectList source={source} group={group} />
      {highlighted.map((path) => <GitlabGroupSummary source={source} group={path} />)}
      <style>
        .overview { text-transform: uppercase; }
      </style>
```

A YAML anchor shares one Template between Routes: `template: &cards |` on the first, `template: *cards` on the others.

## What a Template can use

With no import:

- Every Component, under its file name in `src/components`: see [Components](components.md).
- `source`, `group` and `project`: the Route's values, `undefined` where a Route has none.
- `path`: the full Project path, on `gitlab-project` Routes, as `project` is only its last segment.
- `title` and `description`: those of the page, where the Controller has them.
- `sources`: each Source's `name`, `type`, `url` and `projects`, `mainGroups` or `repositories`, with no token or password.
- `Astro`, as in any Astro file, such as `Astro.url`.

Frontmatter, `{…}` expressions, free HTML, scoped `<style>` and `<script>` all work. Components use the colours of the Theme through the CSS variables `--color-primary`, `--color-background`, `--color-text` and `--color-border`, and a Template can do the same.

## What startup checks

Startup stops, naming the Route, on:

- a Template that does not compile
- an unknown Component, or a missing or unknown prop
- a Component of the wrong Source type for its `source`
- a fixed `source` that does not exist, or a fixed `group` or `project` outside every Main Group

Values computed in `{…}` are not checked: an error there is logged, and Visitors see a short alert inside the page.

## Limits

- `import` does not work, as project files do not exist in the build output.
- `client:*` islands do not work, as they need the build.
- A Template cannot set a status code or redirect.
- A Template cannot place the Controller's own content: to keep part of it, place the same Components.

To go further, fork Vitrine and add a page: see [On a page of a fork](components.md#on-a-page-of-a-fork).

## Templates run as code

A Template runs on the server and can read every environment variable, tokens included. See [Settings is code](security.md#settings-is-code) for who may edit Settings and how to refuse Templates.
