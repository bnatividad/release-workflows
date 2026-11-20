// Discord channel: posts the release summary as an embed through a channel webhook.
//
// Environment: DISCORD_WEBHOOK_URL (enables the channel), DISCORD_STRIPE_COLOR (optional hex color for the stripe on the left
// of a successful message, gray when unset or invalid; a failure is always red).
const DEFAULT_COLOR = 0x95a5a6;
const FAILURE_COLOR = 0xe74c3c;

export default {
  name: "Discord",

  enabled: (env) => Boolean(env.DISCORD_WEBHOOK_URL),

  async send(summary, env, { dryRun }) {
    const hex = (env.DISCORD_STRIPE_COLOR ?? "").trim().replace(/^#/, "");
    const successColor = /^[0-9a-f]{6}$/i.test(hex) ? parseInt(hex, 16) : DEFAULT_COLOR;

    let body = summary.groups
      .map(({ name, items }) => {
        const lines = items.map(({ scope, text, shortHash, url, author }) => {
          const label = scope ? `**${scope}:** ${text}` : text;
          return `• ${label} ([${shortHash}](${url})) - ${author}`;
        });
        return `**${name}**\n${lines.join("\n")}`;
      })
      .join("\n\n");
    if (body.length > 3600) body = `${body.slice(0, 3600)}…`;

    const links = [`[View Full Changelog](${summary.changelogUrl})`];
    if (summary.appUrl) links.unshift(`[Open ${summary.appName}](${summary.appUrl})`);
    if (!summary.ok && summary.runUrl) links.push(`[View the failed run](${summary.runUrl})`);

    const { appName, version } = summary;
    const embed = {
      title: summary.ok ? `${appName} v${version} deployed` : `${appName} v${version} deployment failed`,
      description: `${body}\n\n${links.join(" · ")}`.trim(),
      ...(summary.appUrl ? { url: summary.appUrl } : {}),
      color: summary.ok ? successColor : FAILURE_COLOR,
    };
    const payload = {
      username: appName,
      ...(summary.iconUrl ? { avatar_url: summary.iconUrl } : {}),
      embeds: [embed],
    };

    if (dryRun) {
      console.log(`--- Discord ---\n${JSON.stringify(payload, null, 2)}`);
      return;
    }
    const res = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Discord answered ${res.status}: ${await res.text()}`);
    console.log("Posted to Discord.");
  },
};
