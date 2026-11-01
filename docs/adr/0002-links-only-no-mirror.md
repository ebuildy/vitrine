# Link to content instead of mirroring it

Vitrine shows links and pull commands that point at each Source, and never hosts or proxies the content itself. Access stays with the Source, so some links will fail for some Visitors, for example a Harbor that requires network access. We accepted this over a public mirror because it avoids a second copy that needs syncing and can drift, and Vitrine deliberately does not label which links will work.

## Consequences

- A GitLab Project page shows its README, a cached and sanitized copy rendered by Vitrine, so that a Visitor can judge a Project without leaving. It is held no longer than other cached content, and everything else stays a link.
