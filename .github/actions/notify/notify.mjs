// Release notifier: works out what was released, then hands a channel-neutral summary to every channel whose secret is
// set. Each channel lives in ./channels/<name>.mjs and exports { name, enabled(env), send(summary, env, { dryRun }) }.
// To add a channel, create its file and add it to `channels` below.
//
// Environment: STATE ("success" or anything else for a failure), REPO ("owner/name"), SHA (the release commit),
// PREV_TAG (the tag before this release, may be empty), APP_URL (optional: the public production address),
// RUN_URL (the workflow run, linked on a failure), plus each channel's own variables (see the channel files).
// DRY_RUN=1 prints every channel's message instead of sending it, even for channels without a secret.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import discord from "./channels/discord.mjs";

const channels = [discord];

const env = process.env;
const dryRun = env.DRY_RUN === "1";
const active = channels.filter((channel) => dryRun || channel.enabled(env));
if (!active.length) {
  console.log("No notification channel is configured; skipping.");
  process.exit(0);
}

const repo = env.REPO ?? "";
const sha = env.SHA || execFileSync("git", ["rev-parse", "HEAD"]).toString().trim();
// productName is the display name ("name" is the lower-case package id).
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const appUrl = (env.APP_URL ?? "").trim().replace(/\/$/, "");

// The commits that went out: since the previous release tag, without the bot's own release commit (the last 10 if none).
function commits() {
  const args = ["log", "--no-merges", "--invert-grep", "--grep=^chore(release)", "--format=%H%x09%an%x09%s"];
  const range = env.PREV_TAG ? [`${env.PREV_TAG}..${sha}`, "-n", "15"] : ["-n", "10", sha];
  try {
    return execFileSync("git", [...args, ...range]).toString().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

// Commits grouped as Features / Bug Fixes / Other changes, from their "type(scope)!: description" subjects.
const groups = { Features: [], "Bug Fixes": [], "Other changes": [] };
for (const line of commits()) {
  const [hash, author, ...rest] = line.split("\t");
  const subject = rest.join("\t");
  const m = subject.match(/^(\w+)(?:\(([^)]*)\))?!?: (.*)$/);
  const type = m ? m[1].toLowerCase() : "";
  let text = m ? m[3] : subject;
  if (text.length > 140) text = `${text.slice(0, 139)}…`;
  const group = type === "feat" ? "Features" : type === "fix" ? "Bug Fixes" : "Other changes";
  groups[group].push({
    hash,
    shortHash: hash.slice(0, 7),
    url: `https://github.com/${repo}/commit/${hash}`,
    author,
    scope: m?.[2] || "",
    text,
  });
}

const summary = {
  ok: env.STATE === "success",
  appName: pkg.productName || pkg.name,
  version: pkg.version,
  repo,
  sha,
  appUrl,
  // The site serves public/app-icon.png at /app-icon.png; only usable with the public production address.
  iconUrl: appUrl && existsSync("public/app-icon.png") ? `${appUrl}/app-icon.png` : "",
  changelogUrl: `https://github.com/${repo}/blob/${sha}/CHANGELOG.md`,
  runUrl: env.RUN_URL ?? "",
  groups: Object.entries(groups)
    .filter(([, items]) => items.length)
    .map(([name, items]) => ({ name, items })),
};

let failed = false;
for (const channel of active) {
  try {
    await channel.send(summary, env, { dryRun });
  } catch (error) {
    failed = true;
    console.error(`${channel.name}: ${error.message}`);
  }
}
if (failed) process.exit(1);
