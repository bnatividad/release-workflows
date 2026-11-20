// Posts the "deployed" (or "failed") message to Discord from the shared release pipeline (.github/workflows/vercel-release.yml).
// The message lists the commits since the previous release tag, grouped as Features / Bug Fixes / Other changes.
//
// Environment: WEBHOOK_URL (secret), STATE ("success" or anything else for a failure), REPO ("owner/name"), SHA (the release
// commit), PREV_TAG (the tag before this release, may be empty), APP_URL (optional: the live address; when it is unset or
// empty the message has no link to the site), EMBED_COLOR (optional hex color: the stripe on the left of the
// message for a success, gray when unset; a failure is always red), RUN_URL (the workflow run, shown on a failure).
// DRY_RUN=1 prints the message instead of sending it.
//
// The bot's name is sent with every message, and its picture too when APP_URL is set and the repo has public/app-icon.png
// (the site serves it at /app-icon.png). Use the public production address, not a deployment's own address: those can
// sit behind Vercel's deployment protection, and Discord can't fetch images from them.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const env = process.env;
const dryRun = env.DRY_RUN === "1";
if (!env.WEBHOOK_URL && !dryRun) {
  console.log("DISCORD_WEBHOOK_URL is not set; skipping.");
  process.exit(0);
}

const app = (env.APP_URL ?? "").trim().replace(/\/$/, "");
// Stripe color of the message: EMBED_COLOR if it is a valid hex color, otherwise gray.
const DEFAULT_COLOR = 0x95a5a6;
const hex = (env.EMBED_COLOR ?? "").trim().replace(/^#/, "");
const successColor = /^[0-9a-f]{6}$/i.test(hex) ? parseInt(hex, 16) : DEFAULT_COLOR;
const repo = env.REPO ?? "";
const sha = env.SHA || execFileSync("git", ["rev-parse", "HEAD"]).toString().trim();
// productName is the display name ("name" is the lower-case package id).
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const { version } = pkg;
const appName = pkg.productName || pkg.name;
const ok = env.STATE === "success";

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

const groups = { Features: [], "Bug Fixes": [], "Other changes": [] };
for (const line of commits()) {
  const [hash, author, ...rest] = line.split("\t");
  const subject = rest.join("\t");
  // "type(scope)!: description"
  const m = subject.match(/^(\w+)(?:\(([^)]*)\))?!?: (.*)$/);
  const type = m ? m[1].toLowerCase() : "";
  let text = m ? m[3] : subject;
  if (m?.[2]) text = `**${m[2]}:** ${text}`;
  if (text.length > 140) text = `${text.slice(0, 139)}…`;
  const group = type === "feat" ? "Features" : type === "fix" ? "Bug Fixes" : "Other changes";
  groups[group].push(`• ${text} ([${hash.slice(0, 7)}](https://github.com/${repo}/commit/${hash})) - ${author}`);
}
let body = Object.entries(groups)
  .filter(([, lines]) => lines.length)
  .map(([name, lines]) => `**${name}**\n${lines.join("\n")}`)
  .join("\n\n");
if (body.length > 3600) body = `${body.slice(0, 3600)}…`;

const links = [`[View Full Changelog](https://github.com/${repo}/blob/${sha}/CHANGELOG.md)`];
if (app) links.unshift(`[Open ${appName}](${app})`);
if (!ok && env.RUN_URL) links.push(`[View the failed run](${env.RUN_URL})`);

const embed = {
  title: ok ? `${appName} v${version} deployed` : `${appName} v${version} deployment failed`,
  description: `${body}\n\n${links.join(" · ")}`.trim(),
  ...(app ? { url: app } : {}),
  color: ok ? successColor : 15158332,
};
const avatar = app && existsSync("public/app-icon.png") ? { avatar_url: `${app}/app-icon.png` } : {};
const payload = { username: appName, ...avatar, embeds: [embed] };

if (dryRun) {
  console.log(JSON.stringify(payload, null, 2));
  console.log("\n--- description as Discord shows it ---\n" + embed.description);
} else {
  const res = await fetch(env.WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) {
    console.error(`Discord answered ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  console.log("Posted to Discord.");
}
