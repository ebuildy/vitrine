# Contributing

## Changes

1. Open or pick an issue on [ebuildy/vitrine](https://github.com/ebuildy/vitrine/issues).
2. Work on a branch named `issue-<n>-<slug>`, such as `issue-51-release-process`, never on `main`.
3. Write commit messages as [Conventional Commits](https://www.conventionalcommits.org/): releases and `CHANGELOG.md` are made from them, as [Releases](#releases) explains.
4. Sign off every commit with `git commit -s`, amends included, to certify the [Developer Certificate of Origin](https://developercertificate.org/).
5. Ship the documentation of a change in the same commit, and run `npm run check` and `npm test`. [`AGENTS.md`](AGENTS.md) lists which document each kind of change updates, and what the tests need.
6. Open a pull request against `main`. `image.yaml` runs the tests, then builds the Container image and smoke tests it, without pushing it.

## Coverage

`ci.yaml` runs `npm run test:coverage` (Vitest with the v8 provider), prints the totals in the job summary and uploads the HTML and `lcov` report as the `coverage` artifact. `vitest.config.ts` sets a floor under `test.coverage.thresholds`: a pull request that drops coverage below it goes red. Raise the floor when coverage grows, never lower it to get a pull request through.

Locally, `npm run test:coverage` writes `coverage/` and `npm run test:coverage:report` serves it. Tests that start Vitrine as a child process do not count, because v8 only sees the process that runs Vitest.

## Releases

Nobody bumps `package.json`, edits `CHANGELOG.md` or pushes a `v*` tag by hand. [release-please](https://github.com/googleapis/release-please-action) does it, in `.github/workflows/release.yaml`:

1. Every push to `main` opens or updates one Release PR. It bumps `package.json` and `package-lock.json` to the next version, and writes `CHANGELOG.md` from the commits since the last release.
2. Merging the Release PR tags `vX.Y.Z` and creates the GitHub Release.
3. The tag runs `image.yaml`, which tests, smoke tests and pushes `ghcr.io/ebuildy/vitrine` as `X.Y.Z`, `X.Y` and `X`, for `linux/amd64` and `linux/arm64`.

To release, merge the Release PR. To release later, leave it open: it keeps gathering commits.

The version comes from the commit types:

| Commit | Before `1.0.0` | From `1.0.0` |
| --- | --- | --- |
| `fix:` | patch, `0.3.1` | patch, `1.2.1` |
| `feat:` | minor, `0.4.0` | minor, `1.3.0` |
| `feat!:`, or a `BREAKING CHANGE:` footer | minor, `0.4.0` | major, `2.0.0` |
| `docs:`, `chore:`, `ci:`, `refactor:`, `test:` | no release on their own | no release on their own |

A change is breaking when an Administrator must act on it: a renamed or removed Settings option, Controller, param, Component, prop or environment variable, or a new required one. Its `BREAKING CHANGE:` footer says what to change, because it becomes the changelog entry.

## Setting up the repository

A fork, or a new copy of the repository, needs this once so that releases work. Everything else runs with the `GITHUB_TOKEN` that GitHub Actions gives each workflow.

### Why a personal access token

release-please pushes the `vX.Y.Z` tag. A tag pushed with `GITHUB_TOKEN` starts no other workflow, so `image.yaml` would never build the release. A fine-grained personal access token acts as its owner instead, and its tag starts `image.yaml` as a tag pushed from a laptop would.

The Release PR, its commits and the tag are then made in the token owner's name, and the commits carry the sign-off set in `signoff` of `release-please-config.json`. Set it to the token owner, who certifies them.

### 1. Create the fine-grained token

On GitHub, as the account that owns the repository or a collaborator with write access to it:

1. Open **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**, or go to <https://github.com/settings/personal-access-tokens/new>.
2. **Token name**: `vitrine release-please`.
3. **Resource owner**: the account or organization that owns the repository, such as `ebuildy`. An organization may have to approve the token before it works.
4. **Expiration**: at most a year. Note the date: releases stop when it passes, as [Renewing the token](#renewing-the-token) explains.
5. **Repository access**: **Only select repositories**, then the repository alone, such as `ebuildy/vitrine`.
6. **Permissions** → **Repository permissions**:

   | Permission | Access | What release-please does with it |
   | --- | --- | --- |
   | Contents | Read and write | Commits to the Release PR branch, pushes the tag, creates the GitHub Release |
   | Pull requests | Read and write | Opens and updates the Release PR |
   | Issues | Read and write | Labels the Release PR `autorelease: pending`, then `autorelease: tagged` |
   | Metadata | Read-only | Required by GitHub, selected on its own |

   Leave every other permission at **No access**, account permissions included.
7. **Generate token**, and copy it: GitHub shows it once.

### 2. Create the `prod` environment

The token can push to `main`, so it is a secret of the environment `prod` rather than of the whole repository. Only a workflow on `main` can use it, so a pull request's workflows never see it, even from a branch of the repository itself. The release job of `release.yaml` declares `environment: prod`.

In the repository, open **Settings** → **Environments** → **New environment**, name it `prod`, then **Configure environment**:

- **Deployment branches and tags**: **Selected branches and tags**, then **Add deployment branch or tag rule** → **Branch** `main`.
- **Required reviewers**: leave it off. The release job runs on every push to `main`, and with it on, each push would wait for an approval before the Release PR updates.

Or, with the [GitHub CLI](https://cli.github.com/):

```sh
gh api --method PUT repos/ebuildy/vitrine/environments/prod \
  --input - <<<'{"deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}'
gh api --method POST repos/ebuildy/vitrine/environments/prod/deployment-branch-policies \
  -f name=main -f type=branch
```

### 3. Store the token as a secret of `prod`

In **Settings** → **Environments** → **prod** → **Environment secrets** → **Add environment secret**, name it `RELEASE_PLEASE_TOKEN`, and paste the token. Do not make it a repository secret as well: every workflow would see it then.

Or, with the GitHub CLI, which reads the token from the prompt so that it stays out of the shell history:

```sh
gh secret set RELEASE_PLEASE_TOKEN --env prod --repo ebuildy/vitrine
```

### 4. Check the Actions settings

In **Settings** → **Actions** → **General**:

- **Actions permissions** allow GitHub Actions, and the actions `release.yaml` and `image.yaml` use: `googleapis/release-please-action`, `docker/*` and `actions/*`.
- **Workflow permissions** can stay at **Read repository contents and packages permissions**: `image.yaml` asks for `packages: write` itself, and release-please uses the token, not `GITHUB_TOKEN`. **Allow GitHub Actions to create and approve pull requests** can stay off for the same reason.

### 5. Make the Container image public

The first push of `image.yaml` creates the package `ghcr.io/<owner>/vitrine`, private and linked to the repository. Once it exists, open it from the repository's **Packages**, then **Package settings**:

- **Danger Zone** → **Change visibility** → **Public**, so that a cluster pulls it without credentials.
- **Manage Actions access** lists the repository with the **Write** role. Add it if it is missing, or `image.yaml` fails to push with `denied`.

A fork pushes to its own owner: change `images:` in `image.yaml` from `ghcr.io/ebuildy/vitrine` to its own.

### 6. Check the first release

After the setup, the next push to `main` runs **Release** in the **Actions** tab, which opens a pull request titled `chore(main): release 0.1.0`. With no tag yet, its changelog lists every `feat` and `fix` since the first commit: edit the PR description before merging it if that is too long.

Merging it tags `v0.1.0`, which runs **Container image** on the tag and publishes `0.1.0`, `0.1` and `0`. The image prints `Vitrine 0.1.0+<commit>` first when it starts.

If **Release** fails:

- With `Input required and not supplied: token`, the job found no `RELEASE_PLEASE_TOKEN`: the secret is named differently, or belongs to another environment than `prod`.
- Waiting, or with `Branch "<name>" is not allowed to deploy to prod`, the rules of `prod` do not let `main` use it, or ask for a reviewer: see step 2.
- With `Bad credentials` or `Resource not accessible by personal access token`, the token expired or lacks a permission of step 1.

If the tag exists but **Container image** did not run on it, the tag was pushed with `GITHUB_TOKEN`, which happens only when `release.yaml` no longer passes the token. Fix that, then delete the tag and push it again from a laptop, which starts **Container image**.

### Renewing the token

GitHub emails the token owner before the token expires. Regenerate it from the same page, with the same settings, then update the secret as in step 3. Until then, **Release** fails and no release is made. Nothing else breaks: `edge` keeps following `main`.
