import type { Api } from "grammy";
import { Bot, InlineKeyboard } from "grammy";

import {
  getGroupsByOwnerTgId,
  getGroupByTgId,
  getGroupOwnerMenuStats,
  updateOwnerWallet,
  updateGroupWallet,
} from "@/adapters/groups.adapter.js";
import type { GroupRow } from "@/adapters/groups.adapter.js";
import { hasAdvertiserActivity } from "@/adapters/advertisers.adapter.js";
import { config } from "@/config/index.js";
import { createPortalInviteLink } from "@/telegram/services/portal-invite.js";
import {
  clearSession,
  getSession,
  setSession,
} from "@/telegram/services/session-store.js";
import { startPendingRulesPrompt } from "@/telegram/handlers/register.js";
import { fromMicroUnits } from "@/utils/usdc.js";
import { logger } from "@/utils/logger.js";

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;
const BACK_FOOTER = "\n\nType /start to return to the main menu.";

/** Owner Tg IDs waiting for a new wallet address reply via the menu.
 *  Deliberately in-memory: it's a seconds-long prompt state, not identity context. */
const pendingMenuWallet = new Map<number, true>();

// ─── keyboard builders ────────────────────────────────────────────────────────

function buildModeSelectorKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🏘️ Manage my groups", "mode:owner")
    .text("📢 Run campaigns", "mode:advertiser");
}

function buildGroupPickerKeyboard(groups: GroupRow[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const g of groups) {
    kb.text(g.groupTitle ?? `Group ${g.groupId}`, `select_group:${g.tgGroupId.toString()}`).row();
  }
  return kb;
}

export function buildOwnerMenuKeyboard(showSwitchMode = false): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("📊 My Stats", "menu:stats")
    .text("🔗 Portal Link", "menu:portal")
    .row()
    .text("✏️ Edit Rules", "menu:rules")
    .text("💰 Update Wallet", "menu:wallet")
    .row()
    .text("❓ Help", "menu:help")
    .row()
    .text("🔄 Switch group", "menu:switch_group");
  if (showSwitchMode) kb.row().text("🔄 Switch mode", "menu:switch");
  return kb;
}

function buildAdvertiserKeyboard(showSwitch = false): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("📋 My campaigns", "campaign:list")
    .text("💰 Withdraw refund", "campaign:withdraw_menu")
    .row()
    .text("➕ New campaign", "campaign:buy")
    .text("📈 Top up", "campaign:topup_menu");
  if (showSwitch) kb.row().text("🔄 Switch mode", "menu:switch");
  return kb;
}

function advertiserScreenText(): string {
  const origin = new URL(config.telegram.webhookUrl).origin;
  return (
    "📢 *Advertiser tools*\n\n" +
    "/buy — launch a verified-join campaign\n" +
    "/topup — add budget to your ads\n" +
    "/campaigns — manage ads, pause, or withdraw refunds\n" +
    "/link 0x... — connect your wallet for the dashboard\n" +
    `Dashboard: ${origin}/advertiser`
  );
}

// ─── exported helpers ─────────────────────────────────────────────────────────

export function hasActivePendingMenuWallet(userId: number): boolean {
  return pendingMenuWallet.has(userId);
}

export async function handlePendingMenuWalletReply(
  ctx: { from: { id: number }; reply: (text: string, extra?: object) => Promise<unknown> },
  text: string,
): Promise<boolean> {
  if (!pendingMenuWallet.has(ctx.from.id)) return false;
  const wallet = text.trim();
  if (!WALLET_RE.test(wallet)) {
    await ctx.reply(
      "That doesn't look like a valid Base address. Send a 0x… address, or tap /menu to cancel.",
    );
    return true;
  }
  const session = await getSession(ctx.from.id);
  if (session?.activeTgGroupId) {
    await updateGroupWallet(session.activeTgGroupId, wallet.toLowerCase());
  } else {
    await updateOwnerWallet(BigInt(ctx.from.id), wallet.toLowerCase());
  }
  pendingMenuWallet.delete(ctx.from.id);
  await ctx.reply(`✅ Wallet updated to \`${wallet.toLowerCase()}\``, { parse_mode: "Markdown" });
  logger.info({ ownerTgId: ctx.from.id, wallet }, "Owner wallet updated via menu");
  return true;
}

/**
 * Called from /start and /menu to send the appropriate opening screen.
 * Sends a new message — callbacks edit in-place instead.
 */
export async function handleDmStart(
  api: Api,
  fromId: number,
  ownerGroups: GroupRow[],
  isAdvertiser: boolean,
): Promise<void> {
  const isOwner = ownerGroups.length > 0;
  const send = async (text: string, extra?: object) =>
    api.sendMessage(fromId, text, (extra ?? {}) as Parameters<typeof api.sendMessage>[2]);

  if (isOwner && isAdvertiser) {
    const session = await getSession(fromId);
    if (session?.mode === "owner") {
      await showOwnerScreenOrPicker(fromId, ownerGroups, true, send);
    } else if (session?.mode === "advertiser") {
      await send(advertiserScreenText(), { parse_mode: "Markdown", reply_markup: buildAdvertiserKeyboard(true) });
    } else {
      await send("👋 Welcome back. What would you like to do?", { reply_markup: buildModeSelectorKeyboard() });
    }
  } else if (isOwner) {
    await showOwnerScreenOrPicker(fromId, ownerGroups, false, send);
  } else if (isAdvertiser) {
    await send(advertiserScreenText(), { parse_mode: "Markdown", reply_markup: buildAdvertiserKeyboard(false) });
  }
}

// ─── internal helpers ─────────────────────────────────────────────────────────

type Sender = (text: string, extra?: object) => Promise<unknown>;

/**
 * Route to owner menu if a group is already selected, otherwise show the group picker
 * (or auto-select if the owner has exactly one group).
 */
async function showOwnerScreenOrPicker(
  fromId: number,
  groups: GroupRow[],
  showSwitchMode: boolean,
  send: Sender,
): Promise<void> {
  if (groups.length === 0) {
    await send("No registered groups found.");
    return;
  }
  const session = await getSession(fromId);
  if (session?.activeTgGroupId) {
    // Already have a group selected — go straight to the menu
    await send("What would you like to do?", { reply_markup: buildOwnerMenuKeyboard(showSwitchMode) });
    return;
  }
  if (groups.length === 1) {
    await setSession(fromId, { mode: "owner", activeTgGroupId: groups[0]!.tgGroupId });
    await send("What would you like to do?", { reply_markup: buildOwnerMenuKeyboard(showSwitchMode) });
    return;
  }
  await setSession(fromId, { mode: "owner" });
  await send("Which group?\n\nType /start to return to the main menu.", { reply_markup: buildGroupPickerKeyboard(groups) });
}

/** Resolve the active group from session, or return null if not set. */
async function resolveActiveGroup(fromId: number): Promise<GroupRow | null> {
  const session = await getSession(fromId);
  if (!session?.activeTgGroupId) return null;
  return getGroupByTgId(session.activeTgGroupId);
}

// ─── handler registration ─────────────────────────────────────────────────────

export function registerMenuHandler(bot: Bot): void {
  bot.command("menu", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    const fromId = ctx.from?.id;
    if (!fromId) return;

    const [groups, isAdvertiser] = await Promise.all([
      getGroupsByOwnerTgId(BigInt(fromId)),
      hasAdvertiserActivity(BigInt(fromId)),
    ]);
    const isOwner = groups.length > 0;

    if (!isOwner && !isAdvertiser) {
      await ctx.reply(
        "No registered groups found. Add the bot to your group and run /register there first.",
      );
      return;
    }

    await handleDmStart(ctx.api, fromId, groups, isAdvertiser);
  });

  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    if (
      !data.startsWith("menu:") &&
      !data.startsWith("mode:") &&
      !data.startsWith("select_group:")
    ) {
      await next();
      return;
    }

    const fromId = ctx.from.id;
    await ctx.answerCallbackQuery();

    // ── select_group:{tgGroupId} ───────────────────────────────────────────────
    if (data.startsWith("select_group:")) {
      const tgGroupIdStr = data.slice("select_group:".length);
      let tgGroupId: bigint;
      try {
        tgGroupId = BigInt(tgGroupIdStr);
      } catch {
        await ctx.api.sendMessage(fromId, "Invalid group selection.");
        return;
      }
      const group = await getGroupByTgId(tgGroupId);
      if (!group || Number(group.ownerTgId) !== fromId) {
        await ctx.api.sendMessage(fromId, "Group not found.");
        return;
      }
      const isAdvertiser = await hasAdvertiserActivity(BigInt(fromId));
      await setSession(fromId, { mode: "owner", activeTgGroupId: tgGroupId });
      await ctx.editMessageText("What would you like to do?", {
        reply_markup: buildOwnerMenuKeyboard(isAdvertiser),
      });
      return;
    }

    switch (data) {
      // ── mode selector ──────────────────────────────────────────────────────
      case "mode:owner": {
        const [groups, isAdvertiser] = await Promise.all([
          getGroupsByOwnerTgId(BigInt(fromId)),
          hasAdvertiserActivity(BigInt(fromId)),
        ]);
        const session = await getSession(fromId);
        // Preserve activeTgGroupId if already set — user may be switching back to owner mode
        await setSession(fromId, { mode: "owner", activeTgGroupId: session?.activeTgGroupId });
        const edit: Sender = (text, extra) => ctx.editMessageText(text, extra as Parameters<typeof ctx.editMessageText>[1]);
        await showOwnerScreenOrPicker(fromId, groups, isAdvertiser, edit);
        break;
      }

      case "mode:advertiser": {
        await setSession(fromId, { mode: "advertiser" });
        await ctx.editMessageText(advertiserScreenText(), {
          parse_mode: "Markdown",
          reply_markup: buildAdvertiserKeyboard(true),
        });
        break;
      }

      case "menu:switch": {
        await clearSession(fromId);
        await ctx.editMessageText("👋 Welcome back. What would you like to do?", {
          reply_markup: buildModeSelectorKeyboard(),
        });
        break;
      }

      case "menu:switch_group": {
        const [groups, isAdvertiser] = await Promise.all([
          getGroupsByOwnerTgId(BigInt(fromId)),
          hasAdvertiserActivity(BigInt(fromId)),
        ]);
        const existing = await getSession(fromId);
        // Clear activeTgGroupId so showOwnerScreenOrPicker always triggers picker / auto-select
        await setSession(fromId, { mode: existing?.mode ?? "owner" });
        if (groups.length === 0) {
          await ctx.editMessageText("No registered groups found.");
          break;
        }
        if (groups.length === 1) {
          await setSession(fromId, { mode: "owner", activeTgGroupId: groups[0]!.tgGroupId });
          await ctx.editMessageText("What would you like to do?", {
            reply_markup: buildOwnerMenuKeyboard(isAdvertiser),
          });
        } else {
          await ctx.editMessageText("Which group?\n\nType /start to return to the main menu.", { reply_markup: buildGroupPickerKeyboard(groups) });
        }
        break;
      }

      // ── owner menu actions ─────────────────────────────────────────────────
      case "menu:stats": {
        const group = await resolveActiveGroup(fromId);
        if (!group) {
          const groups = await getGroupsByOwnerTgId(BigInt(fromId));
          await ctx.editMessageText("Which group?\n\nType /start to return to the main menu.", { reply_markup: buildGroupPickerKeyboard(groups) });
          break;
        }
        const allStats = await getGroupOwnerMenuStats(BigInt(fromId));
        const s = allStats.find((stat) => stat.groupId === group.groupId);
        if (!s) {
          await ctx.api.sendMessage(fromId, "No stats found for this group.");
          break;
        }
        const title = s.groupTitle ?? "Your group";
        const earned = fromMicroUnits(s.pendingEarningsMicro).toFixed(2);
        const bidLine =
          s.topBidMicro != null
            ? `$${fromMicroUnits(s.topBidMicro).toFixed(4)} per verification`
            : "No active campaign";
        await ctx.api.sendMessage(
          fromId,
          [
            title,
            `Verifications this week: ${s.verificationsThisWeek}`,
            `Total earned: $${earned}`,
            `Current advertiser: —`,
            `Current bid: ${bidLine}`,
          ].join("\n"),
        );
        break;
      }

      case "menu:portal": {
        const group = await resolveActiveGroup(fromId);
        if (!group) {
          const groups = await getGroupsByOwnerTgId(BigInt(fromId));
          await ctx.editMessageText("Which group?\n\nType /start to return to the main menu.", { reply_markup: buildGroupPickerKeyboard(groups) });
          break;
        }
        try {
          const portalLink =
            group.portalInviteLink ?? (await createPortalInviteLink(bot.api, group));
          if (portalLink) {
            await ctx.api.sendMessage(
              fromId,
              `Here's your portal link to share with new members:\n${portalLink}`,
            );
          } else {
            await ctx.api.sendMessage(
              fromId,
              "Could not generate portal link. Make sure the bot has **Invite users via link** admin permission.",
              { parse_mode: "Markdown" },
            );
          }
        } catch {
          /* ignore */
        }
        break;
      }

      case "menu:rules": {
        const group = await resolveActiveGroup(fromId);
        if (!group) {
          const groups = await getGroupsByOwnerTgId(BigInt(fromId));
          await ctx.editMessageText("Which group?\n\nType /start to return to the main menu.", { reply_markup: buildGroupPickerKeyboard(groups) });
          break;
        }
        startPendingRulesPrompt(fromId, group.groupId);
        const keyboard = new InlineKeyboard().text("Skip", `rules_prompt:skip:${group.groupId}`);
        await ctx.api.sendMessage(
          fromId,
          "Send your updated group rules as a message, one rule per line. Tap Skip to keep your current rules.",
          { reply_markup: keyboard },
        );
        break;
      }

      case "menu:wallet": {
        pendingMenuWallet.set(fromId, true);
        await ctx.api.sendMessage(fromId, "Send your new Base payout wallet address." + BACK_FOOTER);
        break;
      }

      case "menu:help": {
        await ctx.api.sendMessage(
          fromId,
          "Canvas verifies new members before they enter your group.\n\n" +
            "Commands:\n" +
            "/menu — open this menu\n" +
            "/invite — get your portal link\n" +
            "/wallet 0xAddress — update your payout wallet\n\n" +
            "Questions? Reach out to the Canvas team.",
        );
        break;
      }

      default:
        await next();
    }
  });

  // Handle wallet address reply
  bot.on("message:text", async (ctx, next) => {
    const fromId = ctx.from?.id;
    if (!fromId || ctx.chat?.type !== "private" || ctx.message.text.startsWith("/")) {
      await next();
      return;
    }

    const handled = await handlePendingMenuWalletReply(ctx, ctx.message.text.trim());
    if (!handled) {
      await next();
    }
  });
}
