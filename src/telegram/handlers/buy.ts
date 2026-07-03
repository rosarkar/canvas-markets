import { Bot, InlineKeyboard } from "grammy";

import { getTopBidForGroup, placeBid, listTopUpEligibleCampaigns, getCampaignOwnedByAdvertiser, createPendingTopUp } from "@/adapters/bidding.js";
import { listActiveGroups } from "@/adapters/groups.adapter.js";
import { getAdvertiserByTgId } from "@/adapters/advertisers.adapter.js";
import { createTemplate, getTemplateById, listTemplatesForAdvertiser } from "@/adapters/templates.adapter.js";
import { config } from "@/config/index.js";
import {
  ADVERTISER_TASK_TYPES,
  labelOptions,
  TaskType,
  type BinaryReasoningPayload,
  type OpenTextPayload,
  type PreferenceMcPayload,
  type RankReasoningPayload,
  type TaskOption,
  type TaskPayload,
} from "@/services/verification-tasks.js";
import { getEscrowAddress } from "@/services/escrow.js";
import { buildDepositPageUrl, buildTopUpDepositPageUrl } from "@/utils/deposit-sign.js";
import { formatUsdMicro, fromMicroUnits, parseBidInput } from "@/utils/usdc.js";
import { logger } from "@/utils/logger.js";

type BuyStep =
  | "choose_mode"
  | "group"
  | "quantity"
  | "bid"
  | "template_choice"
  | "collect"
  | "name_template"
  | "confirm"
  | "topup_quantity"
  | "topup_confirm";

interface FieldSpec {
  key: string;
  kind: "text" | "list" | "optional-text" | "optional-number";
  prompt: string;
  minItems?: number;
  maxItems?: number;
}

interface BuySession {
  mode?: "new" | "topup";
  advertiserId?: number;
  remainingBudget?: bigint;
  step: BuyStep;
  groupId?: number;
  groupTitle?: string;
  quantity?: number;
  bidMicroUnits?: bigint;
  taskType?: TaskType;
  templateId?: number;
  templateName?: string;
  taskText?: string;
  draft: Record<string, unknown>;
  fieldQueue: string[];
  listBuffer: TaskOption[];
}

const sessions = new Map<number, BuySession>();

const BACK_FOOTER = "\n\nType /start to return to the main menu.";

export function hasActiveBuySession(userId: number): boolean {
  return sessions.has(userId);
}

export const MIN_QUANTITY = config.constants.MIN_CAMPAIGN_QUANTITY;

export function formatUsd(micro: bigint): string {
  return formatUsdMicro(micro);
}

export function buildDepositMessage(input: {
  advertiserId: number;
  expectedDepositMicro: bigint;
  bidMicroUnits: bigint;
  quantity: number;
  groupTitle: string;
  taskText: string;
}): { text: string; keyboard: InlineKeyboard } {
  const escrow = getEscrowAddress();
  if (!escrow) {
    return {
      text: "Escrow not configured. Set ESCROW_CONTRACT_ADDRESS on the server.",
      keyboard: new InlineKeyboard(),
    };
  }

  const totalUsd = formatUsd(input.expectedDepositMicro);
  let depositUrl: string;
  try {
    depositUrl = buildDepositPageUrl(input.advertiserId, input.expectedDepositMicro);
  } catch {
    depositUrl = "";
  }

  const keyboard = new InlineKeyboard();
  if (depositUrl) {
    keyboard.url("Pay with Base", depositUrl).row();
  }
  keyboard.url("View escrow on Basescan", `https://basescan.org/address/${escrow}`);

  const text =
    `**Campaign #${input.advertiserId} created — awaiting deposit**\n\n` +
    `Group: **${input.groupTitle}**\n` +
    `• ${input.quantity} verification(s) @ ${formatUsd(input.bidMicroUnits)} each\n` +
    `• Total: **${totalUsd} USDC** on Base\n` +
    `• Task: ${input.taskText}\n\n` +
    `Tap **Pay with Base** to fund your campaign in one tap.\n\n` +
    `Need USDC? Buy on Coinbase and withdraw to Base network.\n\n` +
    `Expires in 2 hours if no deposit is received.`;

  return { text, keyboard };
}

export function buildTopUpDepositMessage(input: {
  advertiserId: number;
  topupId: number;
  expectedDepositMicro: bigint;
  bidMicroUnits: bigint;
  quantity: number;
  groupTitle: string;
  remainingBudget: bigint;
}): { text: string; keyboard: InlineKeyboard } {
  const escrow = getEscrowAddress();
  if (!escrow) {
    return {
      text: "Escrow not configured. Set ESCROW_CONTRACT_ADDRESS on the server.",
      keyboard: new InlineKeyboard(),
    };
  }

  const totalUsd = formatUsd(input.expectedDepositMicro);
  let depositUrl: string;
  try {
    depositUrl = buildTopUpDepositPageUrl(
      input.topupId,
      input.advertiserId,
      input.expectedDepositMicro,
    );
  } catch {
    depositUrl = "";
  }

  const keyboard = new InlineKeyboard();
  if (depositUrl) {
    keyboard.url("Pay with Base", depositUrl).row();
  }
  keyboard.url("View escrow on Basescan", `https://basescan.org/address/${escrow}`);

  const text =
    `**Add budget to campaign #${input.advertiserId}**\n\n` +
    `Group: **${input.groupTitle}**\n` +
    `• +${input.quantity} verification(s) @ ${formatUsd(input.bidMicroUnits)} each\n` +
    `• Total: **${totalUsd} USDC** on Base\n` +
    `• Current balance: ${formatUsd(input.remainingBudget)}\n\n` +
    `Tap **Pay with Base** to add budget. Expires in 2 hours if unpaid.`;

  return { text, keyboard };
}

export const FORMAT_LABELS: Record<TaskType, string> = {
  [TaskType.PREFERENCE_MC]: "Multiple choice (no wrong answer)",
  [TaskType.RANK_REASONING]: "Ranked choice + reasoning",
  [TaskType.BINARY_REASONING]: "Binary + reasoning",
  [TaskType.OPEN_TEXT]: "Open text",
  [TaskType.TRIVIA_MC]: "Trivia",
  [TaskType.PREFERENCE_WEBAPP]: "Mini App",
};

const FORMAT_FIELDS: Record<string, FieldSpec[]> = {
  [TaskType.PREFERENCE_MC]: [
    {
      key: "prompt",
      kind: "text",
      prompt:
        'What\'s your question? (e.g. "You have idle USDC. What matters most to you?")',
    },
    {
      key: "options",
      kind: "list",
      minItems: 2,
      maxItems: 4,
      prompt:
        'Send each answer option as its own message (2-4 options), then send "done".\n' +
        'Tip: "Label | optional description" adds a description.',
    },
    {
      key: "sponsorName",
      kind: "optional-text",
      prompt: 'Show a sponsor name (e.g. "Moonwell")? Send it, or send "skip".',
    },
    {
      key: "agentOfferMessage",
      kind: "optional-text",
      prompt:
        'Add a follow-up offer shown after they pass (e.g. "Moonwell\'s auto-compounding vault matches what you\'re looking for. Want to connect?")? Send the message, or send "skip".',
    },
  ],
  [TaskType.RANK_REASONING]: [
    {
      key: "prompt",
      kind: "text",
      prompt:
        'What should they rank? (e.g. "Rank these four songs from most to least emotionally impactful")',
    },
    {
      key: "items",
      kind: "list",
      minItems: 3,
      maxItems: 6,
      prompt:
        'Send each item to rank as its own message (3-6 items), then send "done".\n' +
        'Tip: "Title | subtitle" adds a subtitle.',
    },
  ],
  [TaskType.BINARY_REASONING]: [
    {
      key: "prompt",
      kind: "text",
      prompt:
        'What\'s the question? (e.g. "Would you use an AI agent to audit your smart contract before deployment?")',
    },
    { key: "optionA", kind: "text", prompt: "Option A text:" },
    { key: "optionB", kind: "text", prompt: "Option B text:" },
    {
      key: "bonus",
      kind: "optional-number",
      prompt:
        "Pay a quality bonus for a thoughtful reasoned reply? Send a USD amount (e.g. 0.05), or send \"skip\".",
    },
  ],
  [TaskType.OPEN_TEXT]: [
    {
      key: "prompt",
      kind: "text",
      prompt:
        'What\'s your open-ended question? (e.g. "What do you actually look for when buying an NFT?")',
    },
  ],
};

const EXTRA_FIELDS: Record<string, FieldSpec> = {
  agentOfferCtaLabel: {
    key: "agentOfferCtaLabel",
    kind: "text",
    prompt: 'Button label for the offer (e.g. "Open Moonwell"):',
  },
  agentOfferCtaUrl: {
    key: "agentOfferCtaUrl",
    kind: "text",
    prompt: "Link for that button (https://...):",
  },
};

function fieldSpecFor(taskType: TaskType, key: string): FieldSpec {
  const spec = FORMAT_FIELDS[taskType]?.find((f) => f.key === key) ?? EXTRA_FIELDS[key];
  if (!spec) throw new Error(`Unknown template field: ${key}`);
  return spec;
}

export function buildPayloadFromDraft(taskType: TaskType, draft: Record<string, unknown>): TaskPayload {
  switch (taskType) {
    case TaskType.PREFERENCE_MC: {
      const payload: PreferenceMcPayload = {
        prompt: draft.prompt as string,
        options: draft.options as TaskOption[],
      };
      if (draft.sponsorName) payload.sponsorName = draft.sponsorName as string;
      if (draft.agentOfferMessage && draft.agentOfferCtaUrl) {
        payload.agentOffer = {
          message: draft.agentOfferMessage as string,
          ctaLabel: (draft.agentOfferCtaLabel as string) || "Open ↗",
          ctaUrl: draft.agentOfferCtaUrl as string,
        };
      }
      return payload;
    }
    case TaskType.RANK_REASONING:
      return { prompt: draft.prompt as string, items: draft.items as TaskOption[] } satisfies RankReasoningPayload;
    case TaskType.BINARY_REASONING: {
      const [optA, optB] = labelOptions([
        { label: draft.optionA as string },
        { label: draft.optionB as string },
      ]);
      const payload: BinaryReasoningPayload = {
        prompt: draft.prompt as string,
        options: [optA!, optB!],
      };
      if (draft.bonus) payload.bonusMicroUnits = draft.bonus as string;
      return payload;
    }
    case TaskType.OPEN_TEXT:
    default:
      return { prompt: draft.prompt as string } satisfies OpenTextPayload;
  }
}

async function promptNextField(
  ctx: { reply: (text: string, extra?: object) => Promise<unknown> },
  session: BuySession,
  fromId: number,
): Promise<void> {
  const nextKey = session.fieldQueue[0];
  if (!nextKey) {
    session.step = "name_template";
    sessions.set(fromId, session);
    await ctx.reply('Name this template so you can reuse it later (e.g. "Moonwell vault preference"):' + BACK_FOOTER);
    return;
  }
  const spec = fieldSpecFor(session.taskType!, nextKey);
  if (spec.kind === "list") {
    session.listBuffer = [];
  }
  sessions.set(fromId, session);
  await ctx.reply(spec.prompt + BACK_FOOTER);
}

async function showTemplateChoice(
  ctx: { reply: (text: string, extra?: object) => Promise<unknown> },
  session: BuySession,
  fromId: number,
): Promise<void> {
  const templates = await listTemplatesForAdvertiser(BigInt(fromId));
  const keyboard = new InlineKeyboard();
  for (const t of templates) {
    keyboard.text(`📋 ${t.name} (${FORMAT_LABELS[t.taskType]})`, `buy:tpl:${t.templateId}`).row();
  }
  for (const taskType of ADVERTISER_TASK_TYPES) {
    keyboard.text(`✏️ New: ${FORMAT_LABELS[taskType]}`, `buy:format:${taskType}`).row();
  }
  session.step = "template_choice";
  sessions.set(fromId, session);
  await ctx.reply(
    (templates.length > 0
      ? "Reuse a saved template, or create a new one:"
      : "Pick a verification format to customize:") + BACK_FOOTER,
    { reply_markup: keyboard },
  );
}

async function showConfirm(
  ctx: { reply: (text: string, extra?: object) => Promise<unknown> },
  session: BuySession,
): Promise<void> {
  const total = session.bidMicroUnits! * BigInt(session.quantity!);
  const keyboard = new InlineKeyboard().text("Confirm campaign", "buy:confirm:yes").text("Cancel", "buy:confirm:no");
  await ctx.reply(
    `**Confirm campaign for ${session.groupTitle}**\n\n` +
      `• ${session.quantity} verifications @ ${formatUsd(session.bidMicroUnits!)} each\n` +
      `• Total: ${formatUsd(total)} USDC\n` +
      `• Format: ${FORMAT_LABELS[session.taskType!]}\n` +
      `• Template: ${session.templateName ?? "—"}\n` +
      (session.taskText ? `• Question: ${session.taskText}` : "") +
      BACK_FOOTER,
    { parse_mode: "Markdown", reply_markup: keyboard },
  );
}

export async function showGroupPicker(
  ctx: { reply: (text: string, extra?: object) => Promise<unknown>; api: Bot["api"] },
  fromId: number,
): Promise<void> {
  const groups = await listActiveGroups();
  if (groups.length === 0) {
    await ctx.reply("No active groups registered yet. Group owners must /register first.");
    return;
  }

  sessions.set(fromId, { step: "group", mode: "new", draft: {}, fieldQueue: [], listBuffer: [] });

  const keyboard = new InlineKeyboard();
  for (const group of groups) {
    const topBid = await getTopBidForGroup(group.groupId);
    const topLabel = topBid ? formatUsd(topBid.bidPerVerification) : "none";
    let title = `Group #${group.groupId}`;
    try {
      const chat = await ctx.api.getChat(Number(group.tgGroupId));
      if (chat.type !== "private" && "title" in chat) {
        title = chat.title ?? title;
      }
    } catch {
      /* ignore */
    }
    keyboard
      .text(`${title} (top: ${topLabel})`, `buy:group:${group.groupId}:${encodeURIComponent(title)}`)
      .row();
  }

  await ctx.reply(
    "**New campaign**\n\nPick a target group. You'll set quantity, bid per verification, and your verification template." + BACK_FOOTER,
    { parse_mode: "Markdown", reply_markup: keyboard },
  );
}

export async function showBuyEntryMenu(
  ctx: { reply: (text: string, extra?: object) => Promise<unknown>; api: Bot["api"] },
  fromId: number,
  topUpOnly: boolean,
): Promise<void> {
  const myCampaigns = await listTopUpEligibleCampaigns(BigInt(fromId));

  if (topUpOnly && myCampaigns.length === 0) {
    await ctx.reply("No campaigns to top up yet. Send /buy to create one.");
    return;
  }

  if (myCampaigns.length === 0) {
    await showGroupPicker(ctx, fromId);
    return;
  }

  sessions.set(fromId, { step: "choose_mode", draft: {}, fieldQueue: [], listBuffer: [] });

  const keyboard = new InlineKeyboard();
  for (const c of myCampaigns) {
    const status =
      c.campaignStatus === "exhausted"
        ? " · exhausted"
        : c.campaignStatus === "paused"
          ? " · paused"
          : "";
    keyboard
      .text(
        `#${c.advertiserId} ${c.groupTitle ?? "Group"} · ${formatUsd(c.remainingBudget)} left${status}`,
        `buy:topup:${c.advertiserId}`,
      )
      .row();
  }
  if (!topUpOnly) {
    keyboard.text("➕ New campaign", "buy:new").row();
  }

  const intro = topUpOnly
    ? "**Add budget to your ads**\n\nPick a campaign, then choose how many more verifications to fund."
    : "**Advertiser buy flow**\n\n**Your ads** — add budget to keep running, or start a new campaign:";

  await ctx.reply(intro + BACK_FOOTER, { parse_mode: "Markdown", reply_markup: keyboard });
}

async function showTopUpConfirm(
  ctx: { reply: (text: string, extra?: object) => Promise<unknown> },
  session: BuySession,
): Promise<void> {
  const total = session.bidMicroUnits! * BigInt(session.quantity!);
  const keyboard = new InlineKeyboard()
    .text("Confirm top-up", "buy:topup_confirm:yes")
    .text("Cancel", "buy:topup_confirm:no");
  await ctx.reply(
    `**Add budget to campaign #${session.advertiserId}**\n\n` +
      `Group: ${session.groupTitle}\n` +
      `• +${session.quantity} verifications @ ${formatUsd(session.bidMicroUnits!)} each\n` +
      `• Total: ${formatUsd(total)} USDC\n` +
      `• Current balance: ${formatUsd(session.remainingBudget ?? 0n)}` +
      BACK_FOOTER,
    { parse_mode: "Markdown", reply_markup: keyboard },
  );
}

export function registerBuyHandler(bot: Bot): void {
  bot.command("buy", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId || ctx.chat?.type !== "private") {
      await ctx.reply("Send /buy to me in a private chat to start a campaign.");
      return;
    }

    await showBuyEntryMenu(ctx, fromId, false);
  });

  bot.command("topup", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId || ctx.chat?.type !== "private") {
      await ctx.reply("Send /topup in a private chat.");
      return;
    }

    await showBuyEntryMenu(ctx, fromId, true);
  });

  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith("buy:")) {
      await next();
      return;
    }

    const fromId = ctx.from.id;
    const session = sessions.get(fromId);
    if (!session) {
      await ctx.answerCallbackQuery({ text: "Session expired. Send /buy again.", show_alert: true });
      return;
    }

    if (data === "buy:new") {
      await ctx.answerCallbackQuery();
      await showGroupPicker(ctx, fromId);
      return;
    }

    if (data.startsWith("buy:topup:")) {
      const advertiserId = Number(data.split(":")[2]);
      const campaign = await getCampaignOwnedByAdvertiser(advertiserId, BigInt(fromId));
      if (!campaign) {
        await ctx.answerCallbackQuery({ text: "Campaign not found.", show_alert: true });
        return;
      }
      session.mode = "topup";
      session.advertiserId = advertiserId;
      session.groupId = campaign.groupId;
      session.groupTitle = campaign.groupTitle ?? `Group #${campaign.groupId}`;
      session.bidMicroUnits = campaign.bidPerVerification;
      session.remainingBudget = campaign.remainingBudget;
      session.step = "topup_quantity";
      sessions.set(fromId, session);
      await ctx.answerCallbackQuery();
      await ctx.reply(
        `**Campaign #${advertiserId}** · ${session.groupTitle}\n\n` +
          `Bid: ${formatUsd(campaign.bidPerVerification)}/join · Balance: ${formatUsd(campaign.remainingBudget)}\n\n` +
          `How many **additional** verifications do you want to fund? (minimum ${MIN_QUANTITY})` +
          BACK_FOOTER,
        { parse_mode: "Markdown" },
      );
      return;
    }

    if (data.startsWith("buy:group:")) {
      const parts = data.split(":");
      const groupId = Number(parts[2]);
      const groupTitle = decodeURIComponent(parts[3] ?? `Group #${groupId}`);
      session.groupId = groupId;
      session.groupTitle = groupTitle;
      session.step = "quantity";
      sessions.set(fromId, session);
      await ctx.answerCallbackQuery();
      await ctx.reply(
        `Selected **${groupTitle}**.\n\nHow many verifications do you want to fund? (minimum ${MIN_QUANTITY})` + BACK_FOOTER,
        { parse_mode: "Markdown" },
      );
      return;
    }

    if (data.startsWith("buy:tpl:")) {
      const templateId = Number(data.split(":")[2]);
      const template = await getTemplateById(templateId);
      if (!template) {
        await ctx.answerCallbackQuery({ text: "Template not found.", show_alert: true });
        return;
      }
      session.templateId = template.templateId;
      session.taskType = template.taskType;
      session.templateName = template.name;
      session.taskText = (template.payload as { prompt?: string }).prompt;
      session.step = "confirm";
      sessions.set(fromId, session);
      await ctx.answerCallbackQuery();
      await showConfirm(ctx, session);
      return;
    }

    if (data.startsWith("buy:format:")) {
      const taskType = data.split(":")[2] as TaskType;
      session.taskType = taskType;
      session.draft = {};
      session.fieldQueue = (FORMAT_FIELDS[taskType] ?? []).map((f) => f.key);
      session.step = "collect";
      sessions.set(fromId, session);
      await ctx.answerCallbackQuery();
      await promptNextField(ctx, session, fromId);
      return;
    }

    if (data === "buy:topup_confirm:yes") {
      await ctx.answerCallbackQuery();
      if (!session.advertiserId || !session.quantity || !session.bidMicroUnits) {
        await ctx.reply("Incomplete session. Send /topup to start over.");
        sessions.delete(fromId);
        return;
      }

      try {
        const topup = await createPendingTopUp({
          advertiserId: session.advertiserId,
          advertiserTgId: BigInt(fromId),
          verifications: session.quantity,
        });
        if (!topup) {
          await ctx.reply("Could not create top-up. Send /topup to try again.");
          sessions.delete(fromId);
          return;
        }

        const { text, keyboard } = buildTopUpDepositMessage({
          advertiserId: session.advertiserId,
          topupId: topup.topupId,
          expectedDepositMicro: topup.amountMicro,
          bidMicroUnits: session.bidMicroUnits,
          quantity: session.quantity,
          groupTitle: session.groupTitle ?? `Campaign #${session.advertiserId}`,
          remainingBudget: session.remainingBudget ?? 0n,
        });

        await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
        logger.info(
          {
            advertiserId: session.advertiserId,
            topupId: topup.topupId,
            quantity: session.quantity,
            fromId,
          },
          "Campaign top-up pending deposit",
        );
      } catch (err) {
        logger.error({ err }, "createPendingTopUp failed");
        await ctx.reply("Could not create top-up. Please try again.");
      }

      sessions.delete(fromId);
      return;
    }

    if (data === "buy:topup_confirm:no") {
      await ctx.answerCallbackQuery();
      sessions.delete(fromId);
      await ctx.reply("Top-up cancelled.");
      return;
    }

    if (data === "buy:confirm:yes") {
      await ctx.answerCallbackQuery();
      if (!session.groupId || !session.quantity || !session.bidMicroUnits || !session.templateId) {
        await ctx.reply("Incomplete session. Send /buy to start over.");
        sessions.delete(fromId);
        return;
      }

      if (session.bidMicroUnits < config.constants.MIN_BID_MICROUNITS) {
        await ctx.reply(`Minimum bid is ${formatUsd(config.constants.MIN_BID_MICROUNITS)} per verification.`);
        return;
      }

      const topBid = await getTopBidForGroup(session.groupId);
      if (topBid && session.bidMicroUnits <= topBid.bidPerVerification) {
        await ctx.reply(
          `Your bid must exceed the current top bid of ${formatUsd(topBid.bidPerVerification)}. Send /buy to try again.`,
        );
        sessions.delete(fromId);
        return;
      }

      const total = session.bidMicroUnits * BigInt(session.quantity);
      try {
        const result = await placeBid({
          groupId: session.groupId,
          advertiserTgId: BigInt(fromId),
          bidMicroUnits: session.bidMicroUnits,
          quantity: session.quantity,
          taskText: session.taskText,
          templateId: session.templateId,
        });

        const { text, keyboard } = buildDepositMessage({
          advertiserId: result.advertiserId,
          expectedDepositMicro: result.expectedDepositMicro,
          bidMicroUnits: session.bidMicroUnits,
          quantity: session.quantity,
          groupTitle: session.groupTitle ?? `Group #${session.groupId}`,
          taskText: session.taskText ?? session.templateName ?? "Verification task",
        });

        await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });

        logger.info(
          {
            advertiserId: result.advertiserId,
            groupId: session.groupId,
            fromId,
            templateId: session.templateId,
            total: total.toString(),
          },
          "Advertiser campaign pending deposit",
        );

        // Prompt wallet link if advertiser hasn't done it yet
        const linked = await getAdvertiserByTgId(BigInt(fromId));
        if (!linked) {
          await ctx.reply(
            "🔗 Link your Base wallet to track this campaign on the advertiser dashboard:\n`/link 0xYourAddress`",
            { parse_mode: "Markdown" },
          );
        }
      } catch (err) {
        logger.error({ err }, "placeBid failed");
        await ctx.reply("Could not create campaign. Please try again.");
      }

      sessions.delete(fromId);
      return;
    }

    if (data === "buy:confirm:no") {
      await ctx.answerCallbackQuery();
      sessions.delete(fromId);
      await ctx.reply("Campaign cancelled.");
      return;
    }
  });

  bot.on("message:text", async (ctx, next) => {
    const fromId = ctx.from?.id;
    if (!fromId || ctx.chat?.type !== "private") {
      await next();
      return;
    }

    const session = sessions.get(fromId);
    if (!session || ctx.message.text.startsWith("/")) {
      await next();
      return;
    }

    const text = ctx.message.text.trim();

    if (session.step === "choose_mode") {
      await ctx.reply("Use the buttons above to pick a campaign or start a new one.");
      return;
    }

    if (session.step === "topup_quantity") {
      const qty = Number.parseInt(text, 10);
      if (!Number.isFinite(qty) || qty < MIN_QUANTITY) {
        await ctx.reply(`Enter a whole number ≥ ${MIN_QUANTITY}.`);
        return;
      }
      session.quantity = qty;
      session.step = "topup_confirm";
      sessions.set(fromId, session);
      await showTopUpConfirm(ctx, session);
      return;
    }

    if (session.step === "quantity") {
      const qty = Number.parseInt(text, 10);
      if (!Number.isFinite(qty) || qty < MIN_QUANTITY) {
        await ctx.reply(`Enter a whole number ≥ ${MIN_QUANTITY}.`);
        return;
      }
      session.quantity = qty;
      session.step = "bid";
      sessions.set(fromId, session);
      const topBid = session.groupId ? await getTopBidForGroup(session.groupId) : null;
      const hint = topBid
        ? `Current top bid: ${formatUsd(topBid.bidPerVerification)}. Yours must be higher.`
        : `Minimum bid: ${formatUsd(config.constants.MIN_BID_MICROUNITS)}.`;
      await ctx.reply(
        `Bid per verification in USD (e.g. \`0.01\`, \`.01\`, or \`$0.35\`).\n${hint}` + BACK_FOOTER,
        { parse_mode: "Markdown" },
      );
      return;
    }

    if (session.step === "bid") {
      try {
        session.bidMicroUnits = parseBidInput(text);
      } catch (err) {
        await ctx.reply(err instanceof Error ? err.message : "Invalid bid amount.");
        return;
      }
      await showTemplateChoice(ctx, session, fromId);
      return;
    }

    if (session.step === "template_choice") {
      await ctx.reply("Tap one of the buttons above to continue.");
      return;
    }

    if (session.step === "collect") {
      const taskType = session.taskType!;
      const key = session.fieldQueue[0];
      if (!key) {
        await promptNextField(ctx, session, fromId);
        return;
      }
      const spec = fieldSpecFor(taskType, key);

      if (spec.kind === "list") {
        if (text.toLowerCase() === "done") {
          const buffer = session.listBuffer;
          if (buffer.length < (spec.minItems ?? 2)) {
            await ctx.reply(`Add at least ${spec.minItems} before sending "done".`);
            return;
          }
          session.draft[key] = buffer;
          session.listBuffer = [];
          session.fieldQueue.shift();
          await promptNextField(ctx, session, fromId);
          return;
        }
        if (session.listBuffer.length >= (spec.maxItems ?? 6)) {
          await ctx.reply(`Maximum ${spec.maxItems} reached. Send "done" to continue.`);
          return;
        }
        const [label, description] = text.split("|").map((s) => s.trim());
        if (!label) {
          await ctx.reply("Send a label for this option (or \"done\" if you have enough).");
          return;
        }
        const id = String.fromCharCode(65 + session.listBuffer.length).toLowerCase();
        session.listBuffer.push({ id, label, description: description || undefined });
        sessions.set(fromId, session);
        await ctx.reply(
          `Added "${label}" (${session.listBuffer.length}/${spec.maxItems ?? 6}). Send another, or "done" if you have at least ${spec.minItems}.`,
        );
        return;
      }

      if (spec.kind === "optional-text") {
        if (text.toLowerCase() === "skip") {
          session.fieldQueue.shift();
          await promptNextField(ctx, session, fromId);
          return;
        }
        session.draft[key] = text;
        session.fieldQueue.shift();
        if (key === "agentOfferMessage") {
          session.fieldQueue.unshift("agentOfferCtaLabel", "agentOfferCtaUrl");
        }
        await promptNextField(ctx, session, fromId);
        return;
      }

      if (spec.kind === "optional-number") {
        if (text.toLowerCase() === "skip") {
          session.fieldQueue.shift();
          await promptNextField(ctx, session, fromId);
          return;
        }
        try {
          session.draft[key] = parseBidInput(text).toString();
        } catch (err) {
          await ctx.reply(err instanceof Error ? err.message : "Invalid amount.");
          return;
        }
        session.fieldQueue.shift();
        await promptNextField(ctx, session, fromId);
        return;
      }

      // "text"
      if (text.length < 5) {
        await ctx.reply("Please enter a bit more detail (at least 5 characters).");
        return;
      }
      session.draft[key] = text;
      session.fieldQueue.shift();
      await promptNextField(ctx, session, fromId);
      return;
    }

    if (session.step === "name_template") {
      if (text.length < 3) {
        await ctx.reply("Give it a short name (at least 3 characters).");
        return;
      }

      const taskType = session.taskType!;
      const payload = buildPayloadFromDraft(taskType, session.draft);
      const template = await createTemplate({
        advertiserTgId: BigInt(fromId),
        name: text,
        taskType,
        payload,
      });

      session.templateId = template.templateId;
      session.templateName = template.name;
      session.taskText = (payload as { prompt?: string }).prompt;
      session.step = "confirm";
      sessions.set(fromId, session);
      await showConfirm(ctx, session);
      return;
    }

    await next();
  });
}
