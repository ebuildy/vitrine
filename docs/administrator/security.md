# Security

Vitrine has no login. Every Visitor sees the same pages, whoever they are, with the content the tokens and passwords in Settings can read. Read this before you deploy.

## Token permissions are the real boundary

Vitrine knows nothing of private or internal visibility: it shows whatever its credentials read, to everyone. What Settings select narrows that, but only so far:

- GitLab: Vitrine never reads outside the Main Groups, and leaves out confidential Issues and archived Projects. Inside a Main Group, every Group, Project, Issue, Epic and Member the token can read is shown, private Projects included.
- Harbor: `projects` only choose what the Images pages and the Navigation page show by default. The `harbor` Controller lists every Harbor project the Source reports, a `harbor-images` Route with `:project` in its URL shows the Images of any Harbor project the credentials can read, and a Visitor can type any such URL.
- Nexus: a Source with no `repositories` Publishes every Repository its credentials can read.

So give each Source credentials that read only what Visitors may see:

- GitLab: a group access token, or the token of a dedicated account, with the `read_api` scope, a member of the Main Groups only. Never use a GitLab admin's token, which reads every Group of the instance.
- Harbor: a robot account with pull and read access on the Harbor projects Visitors may see. Leave out `username` and `passwordEnv` to read only projects with anonymous access.
- Nexus: a user whose role can browse only the Repositories Visitors may see. Leave out `username` and `passwordEnv` for anonymous access.

A token that reads more than Visitors should see is one Route or one Template away from showing it.

## An internet-exposed installation shows this to anyone

Vitrine shows the content of private Projects to every Visitor, with no login. On an installation reachable from the internet, anyone can read, among the rest:

- **Member emails**: the public email of each Member's GitLab profile, with their name, avatar and location.
- **Issue assignments**: who is assigned to each open Issue and Epic, on Issue pages, Roadmaps and in search.
- **Vulnerability counts**: the critical, high, medium and low vulnerabilities of every scanned Image tag, which tell an attacker which Images to target.

Keep Vitrine on an internal network, or behind an authenticating proxy such as oauth2-proxy, unless all of this may be public.

## Settings is code

A Template runs on the server and can read every environment variable, tokens included. Custom CSS under `theme.css` runs in every Visitor's browser. Only let people trusted with the server edit Settings. Set `VITRINE_TEMPLATE_DISABLE` to any non-empty value, even `false`, to refuse Templates: their Routes then show their Controller's own page, and startup logs a warning naming them.

## Secrets

Settings never hold a secret. They name the environment variable that does: `tokenEnv`, `passwordEnv` and `urlEnv`. Startup stops when one of those variables is not set. Keep Settings in a ConfigMap and secrets in a Secret, and never commit a `settings.yaml` or `.env` with real values: git ignores both, and the Container image leaves them out of its build.

Links in Vitrine lead to GitLab, Harbor and Nexus themselves, where their own access control applies. Vitrine never downloads or mirrors a package or Image.
