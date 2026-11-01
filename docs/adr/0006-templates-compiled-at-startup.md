# Compile Templates from Settings at startup

A Route may carry a Template, Astro markup written inline in Settings that replaces what its Controller renders inside the Layout. Vitrine compiles each Template with Astro's compiler at startup and runs the result as code, so an Administrator gets Astro's syntax, with no rebuild, on the ready-made container image with Settings mounted from a ConfigMap.

## Considered Options

- **Compile at startup (chosen)**: frontmatter, any JavaScript, `<script>` and scoped `<style>` work, and Vitrine needs no interpreter of its own, at the price of running code from Settings.
- **Astro syntax with expressions Vitrine evaluates itself**: cannot run arbitrary code, but it is not Astro's syntax, and it is an interpreter to maintain and keep extending.
- **Restricted markup with bare names only**: the safest and fully checked at startup, but it has no loops or conditions.
- **Component tree in YAML**: the easiest to validate, but verbose, and it has no free HTML.
- **`.astro` files named in Settings**: real Astro through the normal build, but each change needs a new image, which is a fork in all but name.

## Consequences

- Settings is code. A Template can read any environment variable, including Source tokens, and do anything the server process can, so only people trusted with the server may edit Settings. Editing Settings already allowed sending a token elsewhere, through a Source's `url`.
- Vitrine logs a warning at startup when it compiles Templates. Setting `VITRINE_TEMPLATE_DISABLE` to any non-empty value, even `false`, so that a mistyped value never leaves Templates on, stops them being compiled or run: each Route then shows its Controller's own Arrangement, and the warning names the Templates ignored.
- The Astro compiler and its native binary are needed in production, not only to build. The Container image, on `node:24-slim`, compiled and served a Template on both `linux/arm64` and `linux/amd64`.
- Compiled Templates run through Astro's runtime as the build bundled it, handed in by the page, so Components stay recognised. As the build has no file for a Template, its `<style>` is written inline and its `<script>` goes in the page, both in the body, as `<head>` stays the Layout's.
- `import` of project files does not work, as they do not exist in the build output, and neither do `client:*` islands, as they need the build. Vitrine puts Components and Route values in a Template's scope instead.
- Startup cannot fully check code inside `{…}`, so some mistakes only appear when a Visitor opens the page. Such a failure is logged and shown as a short alert inside the Layout, so a Template renders fully before it is sent and is not streamed.
- A Template cannot set a status code or redirect, as those stay with the page around it.
- A fork is still the way to change what a Template cannot, such as adding a Controller or a Component.
