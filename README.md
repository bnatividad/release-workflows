# release-workflows

Reusable GitHub Actions release pipeline: conventional commits → semver bump & changelog → Vercel deploy → Discord notification.

On every push to `main`, the calling project:

1. Checks that every new commit follows [Conventional Commits](https://www.conventionalcommits.org/).
2. Picks the next version from those commits and writes `CHANGELOG.md` with [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version). While the version is below 1.0, `fix` and `feat` bump the patch number and a breaking change bumps the minor number.
3. Builds the versioned app with the Vercel CLI. If the build fails, nothing is pushed.
4. Pushes the release commit and tag, then deploys the prebuilt output to Vercel production.

Notifications are a separate, optional workflow. `discord-notify.yml` runs when the release workflow completes and posts the release notes to Discord, or a failure message with a link to the run. The release pipeline itself has no Discord code.

## Set up a project

These steps assume a Node project with a `package.json` and a `package-lock.json` (the pipeline runs `npm ci`), already linked to a Vercel project.

### 1. Install the dev dependencies

```sh
npm install -D commit-and-tag-version @commitlint/cli @commitlint/config-conventional husky
```

Then add these scripts to `package.json`:

```json
{
  "scripts": {
    "prepare": "husky || true",
    "release": "commit-and-tag-version"
  }
}
```

Optionally add a top-level `"productName": "My App"` to `package.json`. Discord messages use it as the display name, falling back to `name`.

### 2. Add the config files

`.versionrc.json` sets the changelog sections and the release commit message. Keep `releaseCommitMessageFormat` exactly as shown, because the workflows use it to skip the bot's own commit:

```json
{
  "types": [
    { "type": "feat", "section": "Features" },
    { "type": "fix", "section": "Bug Fixes" },
    { "type": "perf", "section": "Performance" },
    { "type": "refactor", "section": "Refactoring" },
    { "type": "docs", "section": "Documentation" },
    { "type": "build", "section": "Build" },
    { "type": "ci", "section": "CI" },
    { "type": "chore", "section": "Chores" },
    { "type": "style", "hidden": true },
    { "type": "test", "hidden": true }
  ],
  "releaseCommitMessageFormat": "chore(release): {{currentTag}}"
}
```

`commitlint.config.mjs`:

```js
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Allow long bodies and trailers (Co-Authored-By, links).
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
};
```

`.husky/commit-msg` checks each commit message locally, so a bad one is caught before it reaches CI:

```sh
npx --no -- commitlint --edit "$1"
```

`vercel.json` must switch off Vercel's own Git deploy of `main`, so this pipeline is the only thing deploying to production. Keep your other settings, such as the framework and build command:

```json
{
  "git": {
    "deploymentEnabled": {
      "main": false
    }
  }
}
```

Run `npm install` once more so `prepare` installs the husky hook.

### 3. Add the release workflow

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

To pin a different Node version, add `with: { node-version: "20" }` under `release`.

### 4. Set the secrets

Run `npx vercel link` in the project if you haven't already. It writes `.vercel/project.json`, which holds `orgId` and `projectId`. Keep `.vercel/` out of git. Create a token at [vercel.com/account/tokens](https://vercel.com/account/tokens), then set the secrets in the project repo:

```sh
gh secret set VERCEL_TOKEN
gh secret set VERCEL_ORG_ID --body "<orgId>"
gh secret set VERCEL_PROJECT_ID --body "<projectId>"
```

| Name | Kind | |
|---|---|---|
| `VERCEL_TOKEN` | secret | Required. |
| `VERCEL_ORG_ID` | secret | Required. The team or account that owns the Vercel project. |
| `VERCEL_PROJECT_ID` | secret | Required. |

### 5. Push to `main`

Commit the files above with a conventional message, such as `ci: add release pipeline`, and push. The first run behaves as follows:

- **No version tag yet:** it tags the current `package.json` version as the first release, without bumping it.
- **Existing `vX.Y.Z` tags:** it bumps from the latest tag as usual.

The bot pushes its release commit straight to `main` using `GITHUB_TOKEN`. If `main` has branch protection that blocks direct pushes, that push fails.

## Add Discord notifications (optional)

1. Add `.github/workflows/release-notify.yml` (also in [`examples/`](examples/release-notify.yml)). The name in `workflows:` must match the `name:` of the release workflow.

   ```yaml
   name: Release notify
   on:
     workflow_run:
       workflows: ["Release and deploy"]
       types: [completed]
       branches: [main]
   jobs:
     discord:
       uses: bnatividad/release-workflows/.github/workflows/discord-notify.yml@v1
       secrets: inherit
   ```

2. Create a webhook in Discord (channel settings → Integrations → Webhooks) and set the secret and variables:

   ```sh
   gh secret set DISCORD_WEBHOOK_URL
   gh variable set APP_URL --body "https://my-app.example.com"
   gh variable set DISCORD_COLOR --body "5865F2"
   ```

| Name | Kind | |
|---|---|---|
| `DISCORD_WEBHOOK_URL` | secret | Without it, nothing is posted. |
| `APP_URL` | variable | Optional. The public production address, linked in the message. With `public/app-icon.png` in the repo, it also gives the bot its avatar. |
| `DISCORD_COLOR` | variable | Optional. Hex stripe color for a successful message (gray by default). A failure is always red. |

The notifier works out the release from git. The new version is the first tag containing the pushed commit, and the notes list the commits since the tag before it. It skips cancelled runs and the bot's own `chore(release)` commit.

`workflow_run` only fires from the copy of this file on the default branch, so the first notification arrives after the file has been merged to `main`.

## Day to day

- Write commits as `type(scope): description`, for example `feat(editor): add undo`. The husky hook rejects other formats locally, and CI rejects them on push.
- `fix` and `feat` release a new patch version while below 1.0. A `!` after the type (`feat!:`), or a `BREAKING CHANGE:` footer, releases a new minor version. Other types are recorded in the changelog with a patch bump.
- Every push to `main` is a production release. Work on a branch and merge when it's ready.
- Pull the bot's release commit (`git pull`) before your next push to `main`.

## Versioning

Callers pin `@v1`. Backward-compatible changes move the `v1` tag; breaking changes get `v2`.
