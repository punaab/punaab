import { getCronSecret, getSiteUrl } from "./config";
import { SHORT_TERM_GOALS } from "./goals";
import { getOwnerDashboard } from "./owner-dashboard";
import { appendPlan, setCurrentThought } from "./owner-state";
import { escapeHtml, sendTelegramMessage, type TelegramMessage } from "./telegram";

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    dateStyle: "short",
    timeStyle: "short",
  });
}

function heartbeatAge(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

const HELP_TEXT = `<b>Punaab Command Bot</b>

<b>Status</b>
/status — heartbeat, usage, allowances
/thought — what punaab is thinking
/karma — Moltbook profile stats
/goals — short-term objectives

<b>Activity</b>
/notifications — unread + recent
/collab — bot collaboration inbox
/apps — built apps &amp; games
/wallets — Base + Solana balances
/trades — recent swap activity
/prediction — Up/Down prediction trader status
/tick — run heartbeat now

<b>Control</b>
/note &lt;text&gt; — instruction for punaab
/help — this message

Dashboard: ${getSiteUrl()}`;

export async function handleTelegramMessage(msg: TelegramMessage): Promise<void> {
  const chatId = msg.chat.id;
  const text = (msg.text ?? "").trim();

  if (!text.startsWith("/")) {
    await sendTelegramMessage(
      chatId,
      "Send /help for commands, or /note <your instruction> for punaab.",
      { parseMode: "HTML" },
    );
    return;
  }

  const [command, ...args] = text.split(/\s+/);
  const argText = args.join(" ").trim();
  const cmd = command.split("@")[0].toLowerCase();

  switch (cmd) {
    case "/start":
      await sendTelegramMessage(
        chatId,
        `<b>Welcome to Punaab Command</b>\n\nYour chat ID: <code>${chatId}</code>\n\nSet this as <code>TELEGRAM_OWNER_CHAT_ID</code> in Vercel if not already configured.\n\n${HELP_TEXT}`,
        { parseMode: "HTML" },
      );
      break;

    case "/help":
      await sendTelegramMessage(chatId, HELP_TEXT, { parseMode: "HTML" });
      break;

    case "/status":
      await cmdStatus(chatId);
      break;

    case "/thought":
      await cmdThought(chatId);
      break;

    case "/karma":
      await cmdKarma(chatId);
      break;

    case "/goals":
      await cmdGoals(chatId);
      break;

    case "/notifications":
      await cmdNotifications(chatId);
      break;

    case "/collab":
      await cmdCollab(chatId);
      break;

    case "/apps":
      await cmdApps(chatId);
      break;

    case "/wallets":
      await cmdWallets(chatId);
      break;

    case "/trades":
      await cmdTrades(chatId);
      break;

    case "/prediction":
      await cmdPrediction(chatId);
      break;

    case "/tick":
      await cmdTick(chatId);
      break;

    case "/note":
      await cmdNote(chatId, argText);
      break;

    default:
      await sendTelegramMessage(
        chatId,
        `Unknown command. Try /help`,
        { parseMode: "HTML" },
      );
  }
}

async function cmdStatus(chatId: number): Promise<void> {
  const d = await getOwnerDashboard();
  const stale =
    !d.status.lastTickAt ||
    Date.now() - new Date(d.status.lastTickAt).getTime() > 75 * 60 * 1000;

  const lines = [
    `<b>⚡ Punaab Status</b>`,
    ``,
    `Heartbeat: ${stale ? "🔴 STALE" : "🟢 LIVE"} (${heartbeatAge(d.status.lastTickAt)})`,
    `Last action: <code>${escapeHtml(d.status.lastAction ?? "—")}</code>`,
    `Last tick: ${formatTime(d.status.lastTickAt)}`,
    ``,
    `Can post: ${d.status.canPost ? "yes" : "no"}`,
    `Can comment: ${d.status.canComment ? "yes" : "no"}`,
    `Upvotes left: ${d.status.upvotesRemaining}`,
    ``,
    `Today: ${d.usage.postsToday} posts · ${d.usage.commentsToday} comments · ${d.usage.upvotesToday} upvotes`,
  ];

  const karma = d.moltbook.profile?.karma;
  if (karma != null) lines.push(`Karma: <b>${karma}</b>`);

  await sendTelegramMessage(chatId, lines.join("\n"), { parseMode: "HTML" });
}

async function cmdThought(chatId: number): Promise<void> {
  const d = await getOwnerDashboard();
  await sendTelegramMessage(
    chatId,
    `<b>💭 Current Thought</b>\n\n${escapeHtml(d.thought ?? "Awaiting first heartbeat…")}`,
    { parseMode: "HTML" },
  );
}

async function cmdKarma(chatId: number): Promise<void> {
  const d = await getOwnerDashboard();
  const p = d.moltbook.profile;
  if (!p) {
    await sendTelegramMessage(chatId, "Could not load Moltbook profile.", {
      parseMode: "HTML",
    });
    return;
  }

  const lines = [
    `<b>📊 u/${escapeHtml(p.name)}</b>`,
    ``,
    `Karma: <b>${p.karma ?? 0}</b>`,
    `Posts: ${p.stats?.posts ?? "—"}`,
    `Comments: ${p.stats?.comments ?? "—"}`,
    `Followers: ${p.follower_count ?? "—"}`,
    `Unread: ${d.moltbook.unreadCount}`,
    ``,
    `<a href="${d.moltbook.profileUrl}">Open on Moltbook</a>`,
  ];
  await sendTelegramMessage(chatId, lines.join("\n"), { parseMode: "HTML" });
}

async function cmdGoals(chatId: number): Promise<void> {
  const goals = SHORT_TERM_GOALS.map((g, i) => `${i + 1}. ${escapeHtml(g)}`).join(
    "\n",
  );
  await sendTelegramMessage(
    chatId,
    `<b>🎯 Short-Term Goals</b>\n\n${goals}`,
    { parseMode: "HTML" },
  );
}

async function cmdNotifications(chatId: number): Promise<void> {
  const d = await getOwnerDashboard();
  const notifs = d.moltbook.notifications.slice(0, 8);
  if (notifs.length === 0) {
    await sendTelegramMessage(chatId, "No notifications.", { parseMode: "HTML" });
    return;
  }

  const lines = [`<b>🔔 Notifications</b> (${d.moltbook.unreadCount} unread)`, ``];
  for (const n of notifs) {
    const read = n.read ? "" : " • NEW";
    const title = escapeHtml(n.displayTitle ?? n.type ?? "alert");
    const actor =
      n.actorName && n.type === "new_follower"
        ? `\n  👤 @${escapeHtml(n.actorName)}`
        : "";
    lines.push(
      `• <i>${title}</i>${read}${actor}\n  ${escapeHtml((n.message ?? "").slice(0, 120))}`,
    );
  }
  await sendTelegramMessage(chatId, lines.join("\n\n"), { parseMode: "HTML" });
}

async function cmdCollab(chatId: number): Promise<void> {
  const d = await getOwnerDashboard();
  if (d.collab.length === 0) {
    await sendTelegramMessage(chatId, "No collab proposals yet.", {
      parseMode: "HTML",
    });
    return;
  }

  const lines = [`<b>🤝 Collab Inbox</b>`, ``];
  for (const c of d.collab.slice(0, 5)) {
    lines.push(
      `<b>${escapeHtml(c.fromAgentName)}</b>${c.karma != null ? ` (karma ${c.karma})` : ""}\n${escapeHtml(c.message.slice(0, 200))}`,
    );
  }
  await sendTelegramMessage(chatId, lines.join("\n\n"), { parseMode: "HTML" });
}

async function cmdApps(chatId: number): Promise<void> {
  const d = await getOwnerDashboard();
  const site = getSiteUrl();

  if (d.publishedLinks.length === 0 && d.apps.length === 0) {
    await sendTelegramMessage(chatId, "No apps built yet.", { parseMode: "HTML" });
    return;
  }

  const lines = [`<b>🛠 Punaab Built</b>`, ``];
  for (const link of d.publishedLinks.slice(0, 10)) {
    lines.push(
      `• <a href="${escapeHtml(link.url)}">${escapeHtml(link.title)}</a> (${escapeHtml(link.kind)})`,
    );
  }
  for (const app of d.apps.slice(0, 10)) {
    const url = `${site}/apps/${app.slug}`;
    if (d.publishedLinks.some((l) => l.url.includes(app.slug))) continue;
    lines.push(
      `• <a href="${url}">${escapeHtml(app.title)}</a> (${escapeHtml(app.kind)})`,
    );
  }
  await sendTelegramMessage(chatId, lines.join("\n"), { parseMode: "HTML" });
}

async function cmdWallets(chatId: number): Promise<void> {
  const d = await getOwnerDashboard();
  if (!d.web3?.balances?.length) {
    await sendTelegramMessage(
      chatId,
      "No wallet snapshot. Set WATCH_BASE_ADDRESS / WATCH_SOLANA_ADDRESS.",
      { parseMode: "HTML" },
    );
    return;
  }

  const lines = [`<b>💰 Wallets</b>`, ``];
  for (const b of d.web3.balances) {
    lines.push(
      `${escapeHtml(b.chain)}: <b>${b.balance} ${b.symbol}</b>\n<code>${escapeHtml(b.address)}</code>`,
    );
  }
  lines.push(`\n<i>Updated ${formatTime(d.web3.capturedAt)}</i>`);
  await sendTelegramMessage(chatId, lines.join("\n\n"), { parseMode: "HTML" });
}

async function cmdTrades(chatId: number): Promise<void> {
  const d = await getOwnerDashboard();
  const lines = [
    `<b>📈 Trading</b>`,
    `Enabled: ${d.trading.enabled ? "yes" : "no"}`,
    `Signer: ${
      d.trading.hasSigner
        ? d.trading.signerMode === "alchemy_cli_session"
          ? "Alchemy CLI session (local)"
          : "private key"
        : "missing — run alchemy wallet connect locally or set agent keys"
    }`,
    ``,
  ];

  if (d.trading.log.length === 0) {
    lines.push("No trades yet.");
  } else {
    for (const t of d.trading.log.slice(0, 5)) {
      const chain = t.chain ?? "solana";
      const sig = t.signature ? `\n  <code>${escapeHtml(t.signature.slice(0, 20))}…</code>` : "";
      lines.push(
        `• [${escapeHtml(chain)}] ${escapeHtml(t.action)} ${t.dryRun ? "(dry)" : ""} — ${escapeHtml(t.inputAmount)} → ${escapeHtml(t.outputAmount ?? "?")}${sig}`,
      );
    }
  }

  await sendTelegramMessage(chatId, lines.join("\n"), { parseMode: "HTML" });
}

async function cmdPrediction(chatId: number): Promise<void> {
  const d = await getOwnerDashboard();
  const p = d.prediction;
  const lines = [
    `<b>Prediction trader</b>`,
    `Enabled: ${p.enabled ? "yes" : "no"}`,
    `Dry run: ${p.dryRun ? "yes" : "no"}`,
    `Jupiter API: ${p.hasApiKey ? "key set" : "missing JUPITER_API_KEY"}`,
    `Signer: ${p.hasSigner ? "yes" : "need SOLANA_AGENT_PRIVATE_KEY"}`,
    `API access: ${p.apiAccess.ok ? "OK" : "geoBlocked" in p.apiAccess && p.apiAccess.geoBlocked ? "GEO BLOCKED" : "error"}`,
    `Trades today: ${p.tradesToday}`,
    `USDC deployed: $${p.usdcDeployedToday.toFixed(2)}`,
  ];
  if (p.lastTick) {
    lines.push(
      ``,
      `Last tick: ${p.lastTick.marketsScanned ?? 0} markets, ${(p.lastTick.signals as unknown[])?.length ?? 0} signals`,
    );
  }
  if (!p.apiAccess.ok && p.apiAccess.error) {
    lines.push(`\n<i>${escapeHtml(String(p.apiAccess.error).slice(0, 160))}</i>`);
  }
  lines.push(`\nLocal: npm run prediction-trader`);
  await sendTelegramMessage(chatId, lines.join("\n"), { parseMode: "HTML" });
}

async function cmdTick(chatId: number): Promise<void> {
  await sendTelegramMessage(chatId, "⏳ Running heartbeat…", { parseMode: "HTML" });

  const secret = getCronSecret();
  const headers: Record<string, string> = { "x-vercel-cron": "1" };
  if (secret) headers.Authorization = `Bearer ${secret}`;

  try {
    const res = await fetch(`${getSiteUrl()}/api/cron/heartbeat`, { headers });
    const data = (await res.json()) as {
      plan?: { action: string; reason?: string };
      executed?: string[];
      errors?: string[];
    };

    const lines = [
      `<b>Heartbeat complete</b>`,
      `Action: <code>${escapeHtml(data.plan?.action ?? "—")}</code>`,
      data.plan?.reason ? `Reason: ${escapeHtml(data.plan.reason)}` : "",
      data.executed?.length ? `Done: ${escapeHtml(data.executed.join(", "))}` : "",
      data.errors?.length ? `⚠️ ${escapeHtml(data.errors.join("; "))}` : "",
    ].filter(Boolean);

    await sendTelegramMessage(chatId, lines.join("\n"), { parseMode: "HTML" });
  } catch (error) {
    await sendTelegramMessage(
      chatId,
      `Heartbeat failed: ${escapeHtml(error instanceof Error ? error.message : "unknown")}`,
      { parseMode: "HTML" },
    );
  }
}

async function cmdNote(chatId: number, text: string): Promise<void> {
  if (!text) {
    await sendTelegramMessage(
      chatId,
      "Usage: /note <instruction for punaab>",
      { parseMode: "HTML" },
    );
    return;
  }

  await setCurrentThought(`[Owner via Telegram] ${text}`);
  await appendPlan(text);
  await sendTelegramMessage(
    chatId,
    `✅ Noted for punaab:\n\n<i>${escapeHtml(text)}</i>`,
    { parseMode: "HTML" },
  );
}
