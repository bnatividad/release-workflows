# release-workflows

Reusable GitHub Actions release pipeline: conventional commits → semver bump & changelog → Vercel deploy → Discord notification.

On every push to `main`, the calling project:

1. Checks that every new commit follows [Conventional Commits](https://www.conventionalcommits.org/).
2. Picks the next version from those commits and writes `CHANGELOG.md` with [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version). While the version is below 1.0, `fix` and `feat` bump the patch number and a breaking change bumps the minor number.
3. Builds the versioned app with the Vercel CLI. If the build fails, nothing is pushed.
4. Pushes the release commit and tag, then deploys the prebuilt output to Vercel production.
5. Posts the release notes to Discord, or a failure message with a link to the run.

## Use it in a project

Add `.github/workflows/release-and-deploy.yml` (also in [`examples/`](examples/release-and-deploy.yml)):

```yaml
name: Release and deploy
on:
  push:
    branches: [main]
concurrency:
  group: release-and-deploy
  cancel-in-progress: false
permissions:
  contents: write
jobs:
  release:
    if: "!startsWith(github.event.head_commit.message, 'chore(release)')"
    uses: bnatividad/release-workflows/.github/workflows/vercel-release.yml@v1
    secrets: inherit
```

The project also needs:

- `package.json` with `"release": "commit-and-tag-version"` and the dev dependencies `commit-and-tag-version`, `@commitlint/cli` and `@commitlint/config-conventional`. An optional `productName` field sets the display name in Discord.
- `.versionrc.json` with `"releaseCommitMessageFormat": "chore(release): {{currentTag}}"`. The `if:` above relies on that format to skip the bot's own commit.
- `commitlint.config.mjs` extending `@commitlint/config-conventional`.
- `vercel.json` with `"git": { "deploymentEnabled": { "main": false } }`, so this pipeline is the only production deploy.
- Optional: `public/app-icon.png`, used as the Discord bot's avatar when `APP_URL` is set.

### Secrets and variables (in the calling repo)

| Name | Kind | |
|---|---|---|
| `VERCEL_TOKEN` | secret | Required. From vercel.com/account/tokens. |
| `VERCEL_ORG_ID` | secret | Required. The team or account that owns the Vercel project. |
| `VERCEL_PROJECT_ID` | secret | Required. |
| `DISCORD_WEBHOOK_URL` | secret | Optional. Without it, the Discord step is skipped. |
| `APP_URL` | variable | Optional. The public production address, linked in the Discord message. |
| `DISCORD_COLOR` | variable | Optional. Hex stripe color for a successful message (gray by default). |

### Inputs

| Input | Default | |
|---|---|---|
| `node-version` | `22` | Node version for install and build. |

## Versioning

Callers pin `@v1`. Backward-compatible changes move the `v1` tag; breaking changes get `v2`.
