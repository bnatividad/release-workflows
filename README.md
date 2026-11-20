# release-workflows

Reusable GitHub Actions release pipeline: conventional commits → semver bump & changelog → Vercel deploy → notifications (Discord, …).

Every push to `main` releases a new version and deploys it to Vercel production. Notifications are a separate, optional workflow that runs when the release finishes; the release pipeline itself has no notification code.

The GitHub repo does not need to be connected to Vercel: the pipeline deploys with the Vercel CLI and a token. This also works for private repos owned by a GitHub organization, which Vercel's free Hobby plan can't connect.

## How it works

### `vercel-release.yml`

Runs on every push to `main`, except the bot's own `chore(release)` commit.

1. **Find the Vercel project.** Reads the project IDs from the `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` secrets, or from the committed `.vercel/project.json`.
2. **Install.** Runs `npm ci`.
3. **Check commits.** Fails if any commit in the push doesn't follow [Conventional Commits](https://www.conventionalcommits.org/).
4. **Version.** [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) picks the next version from the commits, updates `package.json` and `CHANGELOG.md`, and creates the `chore(release): vX.Y.Z` commit and tag locally. Below 1.0, `fix`/`feat` bump the patch and a breaking change bumps the minor. With no tag yet, it tags the current version as the first release.
5. **Build.** `vercel pull` and `vercel build --prod`. If this fails, nothing has been pushed.
6. **Push.** Pushes the release commit and tag to the branch that triggered the run.
7. **Deploy.** `vercel deploy --prebuilt --prod`.
8. **Record the deployment.** Looks up the production domain from Vercel (or uses `app-url`) and records a GitHub Deployment for the release commit with that URL. If this step fails, it only warns.

### `notify.yml`

Runs when the release workflow completes. It skips runs that were skipped or cancelled.

1. **Find the release.** The new tag is the first tag containing the pushed commit; the previous tag is the latest one before it. If the run failed before tagging, there is no new tag.
2. **Find the live address.** Reads the URL from the release's GitHub Deployment, or from the latest production deployment if this run didn't deploy.
3. **Notify.** Posts to every channel whose secret is set; with none set, it posts nothing. On success the message is "*App* vX.Y.Z deployed", with the commits since the previous tag grouped into Features, Bug Fixes and Other changes. It links the live site and the changelog. On failure the message says "deployment failed" and links the failed run.

Each channel is one file in [`.github/actions/notify/channels/`](.github/actions/notify/channels/).

## Set up a project

These steps assume a Node project with a `package.json` and a `package-lock.json` (the pipeline runs `npm ci`). Setup needs one secret, `VERCEL_TOKEN`, plus `DISCORD_WEBHOOK_URL` if you want notifications.

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

**Optional: `.versionrc.json`.** By default, `CHANGELOG.md` lists only Features (`feat`) and Bug Fixes (`fix`). Other types still trigger a release, but they get no changelog entry. To list more types, add a `.versionrc.json`. This one also shows performance changes and reverts, as release-please and semantic-release do:

```json
{
  "types": [
    { "type": "feat", "section": "Features" },
    { "type": "fix", "section": "Bug Fixes" },
    { "type": "perf", "section": "Performance" },
    { "type": "revert", "section": "Reverts" }
  ]
}
```

Don't set `releaseCommitMessageFormat` in it. The workflows rely on the default `chore(release): vX.Y.Z` to skip the bot's own commit.

Run `npm install` once more so `prepare` installs the husky hook.

### 3. Add the release workflow

Add `.github/workflows/release-and-deploy.yml` (also in [`templates/`](templates/.github/workflows/release-and-deploy.yml)):

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
  deployments: write
jobs:
  release:
    if: "!startsWith(github.event.head_commit.message, 'chore(release)')"
    uses: bnatividad/release-workflows/.github/workflows/vercel-release.yml@v1
    secrets: inherit
```

You may change `branches: [main]` to your release branch. Make sure it's the same in `release-notify.yml` if you add notifications. The pipeline pushes the release commit back to whichever branch triggered it.

Optional inputs, set with `with:` under `release`:

| Input | Default | |
|---|---|---|
| `node-version` | `22` | Node version for install and build. |
| `app-url` | (from Vercel) | Production address to record and link. Only needed if the project has several custom domains and the wrong one is picked. |

### 4. Link the Vercel project and set the token

Run `npx vercel link` in the project. It creates or picks the Vercel project and writes `.vercel/project.json` with its `orgId` and `projectId`. The pipeline needs these IDs. Give them to it in one of two ways:

**Commit `.vercel/project.json` (recommended).** The IDs aren't secret. `vercel link` adds a `.vercel` line to `.gitignore`, which ignores the whole folder. Replace that line with these two, so `project.json` is committed in step 5 while the rest of `.vercel/` stays ignored (`vercel pull` can write environment files there):

```gitignore
.vercel/*
!.vercel/project.json
```

**Or set them as GitHub secrets.** Keep the `.vercel` line in `.gitignore` and copy the two IDs from `.vercel/project.json`:

```sh
gh secret set VERCEL_ORG_ID --body "<orgId>"
gh secret set VERCEL_PROJECT_ID --body "<projectId>"
```

If both are present, the secrets take precedence over the file. `vercel.json` can't hold these IDs.

Either way, create a token at [vercel.com/account/tokens](https://vercel.com/account/tokens) and set it in the project repo:

```sh
gh secret set VERCEL_TOKEN
```

### 5. Push to `main`

If you want notifications, [set them up](#add-notifications-optional) before proceeding with this step. The notifier only fires once its file is on the release branch, so adding it afterwards means the first release posts nothing.

Commit the files above with a conventional message, such as `ci: add release pipeline`, and push. The first run behaves as follows:

- **No version tag yet:** it tags the current `package.json` version as the first release, without bumping it.
- **Existing `vX.Y.Z` tags:** it bumps from the latest tag as usual.

The bot pushes its release commit straight to `main` using `GITHUB_TOKEN`. If `main` has branch protection that blocks direct pushes, that push fails.

## Add notifications (optional)

1. Add `.github/workflows/release-notify.yml` (also in [`templates/`](templates/.github/workflows/release-notify.yml)). The name in `workflows:` must match the `name:` of the release workflow. The `branches: [main]` must also match the release branch set in `release-and-deploy.yml`.

   ```yaml
   name: Release notify
   on:
     workflow_run:
       workflows: ["Release and deploy"]
       types: [completed]
       branches: [main]
   permissions:
     contents: read
     deployments: read
   jobs:
     notify:
       uses: bnatividad/release-workflows/.github/workflows/notify.yml@v1
       secrets: inherit
       with:
         discord-color: "95A5A6" # Stripe color of a successful message. Failure is always red.
   ```

2. Turn on the channels you want by setting their secrets.

### Discord

Create a webhook in Discord (channel settings → Integrations → Webhooks) and set it as a secret:

```sh
gh secret set DISCORD_WEBHOOK_URL
```

With `public/app-icon.png` in the repo, the bot uses it as its avatar. To change the color, replace `"95A5A6"` (gray) with any [hex value](https://htmlcolorcodes.com/).

### Notes

`workflow_run` only fires from the copy of this file on the default branch, so the first notification arrives after the file has been merged to `main`.

## Preview deploys (optional)

To get a preview URL for every branch and pull request, connect the GitHub repo to the Vercel project in Vercel's dashboard. Then add a `vercel.json` that switches off Vercel's own deploy of `main`, so this pipeline stays the only production deploy:

```json
{
  "git": {
    "deploymentEnabled": {
      "main": false
    }
  }
}
```

On the Hobby plan this only works for repos owned by a personal account, not by a GitHub organization.

## Day to day

- Write commits as `type(scope): description`, for example `feat(editor): add undo`. The husky hook rejects other formats locally, and CI rejects them on push.
- `fix` and `feat` release a new patch version while below 1.0. A `!` after the type (`feat!:`), or a `BREAKING CHANGE:` footer, releases a new minor version. Other types also release a patch version, but appear in the changelog only if `.versionrc.json` lists them.
- Every push to `main` is a production release. Work on a branch and merge when it's ready.
- Pull the bot's release commit (`git pull`) before your next push to `main`.

## Versioning

Callers pin `@v1`. Backward-compatible changes move the `v1` tag; breaking changes get `v2`.
