import { Bot, InlineKeyboard } from "grammy";

import {
  getGroupByTgId,
  getGroupsByOwnerTgId,
  registerGroup,
  updateGroupRules,
  updateOwnerWallet,
  type GroupRow,
} from "@/adapters/groups.adapter.js";
import { createPortalInviteLink } from "@/telegram/services/portal-invite.js";
import { logger } from "@/utils/logger.js";

const PLACEHOLDER_WALLET = "0x0000000000000000000000000000000000000000";
const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;
const BACK_FOOTER = "\n\nType /start to return to the main menu.";

const ADMIN_CHECKLIST =
  "Bot admin permissions needed: **Ban users**, **Restrict members**, **Invite users via link**.\n" +
  "In @BotFather: **Group Privacy → Disabled** (so join-request DMs work).";

/** Pending wallet updates awaiting inline-keyboard confirmation. userId → new wallet */
const pendingWallets = new Map<number, string>();

/** Owners with an open "set custom rules?" prompt awaiting a text reply or Skip tap. userId → groupId */
const pendingRulesPrompt = new Map<number, number>();

export function hasActivePendingRulesPrompt(userId: number): boolean {
  return pendingRulesPrompt.has(userId);
}

/** Sets the pending rules state so the menu handler can trigger the rules-edit flow. */
export function startPendingRulesPrompt(userId: number, groupId: number): void {
  pendingRulesPrompt.set(userId, groupId);
}

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

/** Asks the owner for custom rules (or Skip) once a group has a real wallet and no rules yet. */
async function maybeSendRulesPrompt(
  bot: Bot,
  ownerTgId: number,
  group: GroupRow,
  groupTitle: string,
): Promise<void> {
  if (group.ownerWallet === PLACEHOLDER_WALLET || group.rules.length > 0) return;

  pendingRulesPrompt.set(ownerTgId, group.groupId);
  const keyboard = new InlineKeyboard().text("Skip", `rules_prompt:skip:${group.groupId}`);
  try {
    await bot.api.sendMessage(
      ownerTgId,
      `Do you want to set custom rules for **${groupTitle}**? These will be shown to every new member after they pass verification.\n\n` +
        "Send your rules as a message, or tap Skip to use the defaults." +
        BACK_FOOTER,
      { parse_mode: "Markdown", reply_markup: keyboard },
    );
  } catch (err) {
    pendingRulesPrompt.delete(ownerTgId);
    logger.warn({ err, groupId: group.groupId }, "Failed to send rules prompt");
  }
}

/** Handles a DM text reply to the rules prompt. Returns false if no prompt is pending. */
export async function handlePendingRulesReply(
  ctx: { from: { id: number }; reply: (text: string, extra?: object) => Promise<unknown> },
  text: string,
): Promise<boolean> {
  const groupId = pendingRulesPrompt.get(ctx.from.id);
  if (groupId == null) return false;

  const rules = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (rules.length === 0) return false;

  await updateGroupRules(groupId, rules);
  pendingRulesPrompt.delete(ctx.from.id);
  await ctx.reply("✅ Rules saved. New members will see these after they pass verification.");
  logger.info({ groupId, ownerTgId: ctx.from.id, ruleCount: rules.length }, "Group rules set via owner prompt");
  return true;
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
          "Or DM /wallet 0xYourBaseWallet after registering." +
          BACK_FOOTER,
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
      groupTitle: title ?? undefined,
    });

    logger.info(
      { groupId: group.groupId, tgGroupId: chat.id, ownerTgId: fromId, title },
      "Group registered",
    );

    await ctx.reply(
      `✅ **${title}** is now verified by Canvas. New members will be asked to complete a quick verification before joining.`,
      { parse_mode: "Markdown" },
    );

    const portalLink = group.portalInviteLink ?? (await createPortalInviteLink(bot.api, group));
    const portalNote = portalLink
      ? `Here's your verification portal link — share this instead of a regular invite link:\n${portalLink}`
      : "Run /invite in your group to generate a portal link (bot needs **Invite users via link** permission).";
    const walletNote =
      wallet === PLACEHOLDER_WALLET
        ? "set or update anytime by DMing me:\n`/wallet 0xYourAddress`"
        : `\`${wallet}\` — update anytime with:\n\`/wallet 0xNewAddress\``;

    try {
      await bot.api.sendMessage(
        fromId,
        `✅ **${title}** is registered.\n\n` +
          `${portalNote}\n\n` +
          "New members who use a regular invite link will be muted until they verify via DM.\n\n" +
          `Your payout wallet: ${walletNote}\n\n` +
          "Bot admin permissions needed: **Ban users**, **Restrict members**, **Invite users via link**.\n\n" +
          "In @BotFather: **Group Privacy → Disabled** (so join-request DMs work). " +
          "Optional: Group Settings → **Chat history for new members → Hidden**." +
          BACK_FOOTER,
        { parse_mode: "Markdown" },
      );
    } catch {
      /* Owner hasn't started the bot in DM yet — they'll see the group message */
    }

    await maybeSendRulesPrompt(bot, fromId, group, title ?? "your group");
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

    if (ctx.chat?.type !== "private") {
      await ctx.reply("Please set your wallet in our DM to keep it private.");
      return;
    }

    const wallet = parseWallet(ctx.match);

    if (!wallet) {
      // No address provided — show current wallet
      const groups = await getGroupsByOwnerTgId(BigInt(fromId));
      if (groups.length === 0) {
        await ctx.reply(
          "No registered groups found for your account. Register a group first with /register inside the group.",
        );
        return;
      }
      const currentWallet = groups[0]!.ownerWallet;
      const isPlaceholder = currentWallet === PLACEHOLDER_WALLET;
      await ctx.reply(
        (isPlaceholder
          ? "No payout wallet set yet.\n\nSend your Base address:\n`/wallet 0xYourAddress`"
          : `Current payout wallet:\n\`${currentWallet}\`\n\nTo update it: /wallet 0xNewAddress`) +
          BACK_FOOTER,
        { parse_mode: "Markdown" },
      );
      return;
    }

    // Address provided — look up current and ask for confirmation
    const groups = await getGroupsByOwnerTgId(BigInt(fromId));
    if (groups.length === 0) {
      await ctx.reply(
        "No registered groups found for your account. Register a group first with /register inside the group.",
      );
      return;
    }

    const currentWallet = groups[0]!.ownerWallet;
    const isPlaceholder = currentWallet === PLACEHOLDER_WALLET;

    pendingWallets.set(fromId, wallet);

    const header = isPlaceholder
      ? "Setting payout wallet to:"
      : `Changing payout wallet\n\nFrom: \`${currentWallet}\`\nTo:`;

    const keyboard = new InlineKeyboard()
      .text("Confirm", "wallet:confirm")
      .text("Cancel", "wallet:cancel");

    await ctx.reply(
      `${header}\n\`${wallet}\`\n\nConfirm this address?` + BACK_FOOTER,
      { parse_mode: "Markdown", reply_markup: keyboard },
    );
  });

  // Wallet confirmation / cancellation
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith("wallet:")) {
      await next();
      return;
    }

    const fromId = ctx.from.id;

    if (data === "wallet:confirm") {
      const wallet = pendingWallets.get(fromId);
      if (!wallet) {
        await ctx.answerCallbackQuery({ text: "Session expired. Send /wallet again.", show_alert: true });
        return;
      }
      await ctx.answerCallbackQuery();
      const updated = await updateOwnerWallet(BigInt(fromId), wallet);
      pendingWallets.delete(fromId);
      await ctx.editMessageText(
        `✅ Payout wallet updated on ${updated} group(s):\n\`${wallet}\``,
        { parse_mode: "Markdown" },
      );
      logger.info({ ownerTgId: fromId, wallet, groupsUpdated: updated }, "Owner wallet confirmed and updated");

      const ownerGroups = await getGroupsByOwnerTgId(BigInt(fromId));

      const primaryGroup = ownerGroups[0];
      if (primaryGroup) {
        try {
          const portalLink =
            primaryGroup.portalInviteLink ?? (await createPortalInviteLink(bot.api, primaryGroup));
          if (portalLink) {
            await bot.api.sendMessage(
              fromId,
              `Here's your portal link to share with new members:\n${portalLink}\n\nSave this — anyone who joins via this link will be verified before entering.`,
            );
          }
        } catch {
          /* ignore */
        }
      }

      const groupNeedingRules = ownerGroups.find((g) => g.rules.length === 0);
      if (groupNeedingRules) {
        let groupTitle = groupNeedingRules.groupTitle ?? "your group";
        try {
          const chat = await ctx.api.getChat(Number(groupNeedingRules.tgGroupId));
          if (chat.type !== "private" && "title" in chat) groupTitle = chat.title ?? groupTitle;
        } catch {
          /* ignore */
        }
        await maybeSendRulesPrompt(bot, fromId, groupNeedingRules, groupTitle);
      }
      return;
    }

    if (data === "wallet:cancel") {
      pendingWallets.delete(fromId);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText("Wallet update cancelled.");
      return;
    }

    await next();
  });

  // "Skip" tap on the post-registration rules prompt
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith("rules_prompt:skip:")) {
      await next();
      return;
    }

    const fromId = ctx.from.id;
    const groupId = Number(data.slice("rules_prompt:skip:".length));

    if (pendingRulesPrompt.get(fromId) !== groupId) {
      await ctx.answerCallbackQuery({ text: "This prompt is no longer active.", show_alert: true });
      return;
    }

    pendingRulesPrompt.delete(fromId);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Got it — using default rules.");
  });

  // Text reply to the post-registration rules prompt
  bot.on("message:text", async (ctx, next) => {
    const fromId = ctx.from?.id;
    if (!fromId || ctx.chat?.type !== "private" || ctx.message.text.startsWith("/")) {
      await next();
      return;
    }

    const handled = await handlePendingRulesReply(ctx, ctx.message.text.trim());
    if (!handled) {
      await next();
    }
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
    groupTitle: chatTitle,
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
