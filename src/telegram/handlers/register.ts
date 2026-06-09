import { Bot } from "grammy";

import {
  getGroupByTgId,
  registerGroup,
  updateOwnerWallet,
} from "@/adapters/groups.adapter.js";
import { createPortalInviteLink } from "@/telegram/services/portal-invite.js";
import { logger } from "@/utils/logger.js";

const PLACEHOLDER_WALLET = "0x0000000000000000000000000000000000000000";
const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;

const ADMIN_CHECKLIST =
  "Bot admin permissions needed: **Ban users**, **Restrict members**, **Invite users via link**.\n" +
  "In @BotFather: **Group Privacy → Disabled** (so join-request DMs work).";

function parseWallet(input: string | undefined): string | null {
  const trimmed = input?.trim();
  if (!trimmed || !WALLET_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

async function isUserGroupAdmin(
  bot: Bot,
  chatId: number,
  userId: number,
): Promise<boolean> {
  const member = await bot.api.getChatMember(chatId, userId);
  return member.status === "creator" || member.status === "administrator";
}

async function isBotGroupAdmin(bot: Bot, chatId: number): Promise<boolean> {
  const me = await bot.api.getMe();
  const member = await bot.api.getChatMember(chatId, me.id);
  return member.status === "administrator";
}

async function replyWithPortalLink(bot: Bot, chatId: number, extra = ""): Promise<void> {
  const group = await getGroupByTgId(BigInt(chatId));
  if (!group) return;

  const portalLink =
    group.portalInviteLink ?? (await createPortalInviteLink(bot.api, group));

  const linkNote = portalLink
    ? `\n\nShare this **verification portal** link:\n${portalLink}`
    : "\n\nRun /invite to generate a join-request portal link (bot needs **Invite users via link**).";

  await bot.api.sendMessage(
    chatId,
    extra +
      linkNote +
      "\n\nOpen invite links still work: new members are muted until they verify via DM.",
    { parse_mode: "Markdown" },
  );
}

export function registerRegisterHandler(bot: Bot): void {
  bot.command("register", async (ctx) => {
    const chat = ctx.chat;
    const fromId = ctx.from?.id;
    if (!fromId) return;

    if (chat.type === "private") {
      await ctx.reply(
        "To register your group:\n\n" +
          "1. Add @CanvasProtocolBot to your group\n" +
          `2. ${ADMIN_CHECKLIST}\n` +
          "3. Run /register inside the group\n\n" +
          "Optional: /register 0xYourBaseWallet (in the group) to set payout wallet now.\n" +
          "Or DM /wallet 0xYourBaseWallet after registering.",
        { parse_mode: "Markdown" },
      );
      return;
    }

    if (chat.type !== "group" && chat.type !== "supergroup") return;

    if (!(await isUserGroupAdmin(bot, chat.id, fromId))) {
      await ctx.reply("Only group admins can register this group.");
      return;
    }

    if (!(await isBotGroupAdmin(bot, chat.id))) {
      await ctx.reply(
        `Make me an admin first.\n\n${ADMIN_CHECKLIST}`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    const wallet = parseWallet(ctx.match) ?? PLACEHOLDER_WALLET;
    const title = "title" in chat ? chat.title : "Group";

    const group = await registerGroup({
      tgGroupId: BigInt(chat.id),
      ownerWallet: wallet,
      ownerTgId: BigInt(fromId),
      verificationTaskText: "In one sentence: what do you use DeFi for?",
    });

    logger.info(
      { groupId: group.groupId, tgGroupId: chat.id, ownerTgId: fromId, title },
      "Group registered",
    );

    const walletNote =
      wallet === PLACEHOLDER_WALLET
        ? "\n\nSet your Base payout wallet anytime with /wallet 0xYourAddress (here or in DM)."
        : `\n\nPayout wallet: \`${wallet}\``;

    await ctx.reply(
      `✅ **${title}** is registered.\n\n` +
        "Rose-style verification:\n" +
        "• **Portal link** (/invite): captcha in DM before they enter\n" +
        "• **Open invite**: muted + welcome button → verify in DM\n\n" +
        `${ADMIN_CHECKLIST}\n` +
        "Optional: Group Settings → **Chat history for new members** → **Hidden**" +
        walletNote,
      { parse_mode: "Markdown" },
    );

    await replyWithPortalLink(bot, chat.id);
  });

  bot.command("invite", async (ctx) => {
    const chat = ctx.chat;
    const fromId = ctx.from?.id;
    if (!fromId) return;

    if (chat.type === "private") {
      await ctx.reply("Run /invite inside your registered group.");
      return;
    }

    if (chat.type !== "group" && chat.type !== "supergroup") return;

    if (!(await isUserGroupAdmin(bot, chat.id, fromId))) {
      await ctx.reply("Only group admins can generate the portal link.");
      return;
    }

    const group = await getGroupByTgId(BigInt(chat.id));
    if (!group?.isActive) {
      await ctx.reply("This group is not registered. Run /register first.");
      return;
    }

    const portalLink = await createPortalInviteLink(bot.api, group);
    if (!portalLink) {
      await ctx.reply(
        "Could not create portal link. Ensure I have **Invite users via link** admin permission.",
        { parse_mode: "Markdown" },
      );
      return;
    }

    await ctx.reply(
      `**Verification portal link** for this group:\n${portalLink}\n\n` +
        "Share this link so new members verify in DM before they can see the group.",
      { parse_mode: "Markdown" },
    );
  });

  bot.command("wallet", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId) return;

    const wallet = parseWallet(ctx.match);
    if (!wallet) {
      await ctx.reply("Send your Base wallet like:\n/wallet 0x1234...abcd");
      return;
    }

    const updated = await updateOwnerWallet(BigInt(fromId), wallet);
    if (updated === 0) {
      await ctx.reply(
        "No registered groups found for your account. Register a group first with /register inside the group.",
      );
      return;
    }

    logger.info({ ownerTgId: fromId, wallet, groupsUpdated: updated }, "Owner wallet updated");
    await ctx.reply(`✅ Payout wallet updated on ${updated} group(s):\n\`${wallet}\``, {
      parse_mode: "Markdown",
    });
  });
}

export async function autoRegisterGroupOnBotAdd(
  bot: Bot,
  chatId: number,
  chatTitle: string,
  addedByUserId: number,
): Promise<void> {
  const existing = await getGroupByTgId(BigInt(chatId));
  if (existing) return;

  const group = await registerGroup({
    tgGroupId: BigInt(chatId),
    ownerWallet: PLACEHOLDER_WALLET,
    ownerTgId: BigInt(addedByUserId),
    verificationTaskText: "In one sentence: what do you use DeFi for?",
  });

  logger.info(
    { groupId: group.groupId, tgGroupId: chatId, addedByUserId, title: chatTitle },
    "Auto-registered group when bot was added as admin",
  );

  try {
    await bot.api.sendMessage(
      chatId,
      "Canvas is active — new members verify via DM (Rose-style).\n\n" +
        "Group owner: run /register, then /invite for the verification portal link.",
    );
  } catch (err) {
    logger.warn({ err, chatId }, "Failed to post auto-register notice");
  }
}
