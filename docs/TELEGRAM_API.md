# Canvas AI — Telegram API Reference

> Canonical source: [Telegram Bot API](https://core.telegram.org/bots/api) (Bot API **10.1**, June 2026).  
> Mini Apps: [Telegram Mini Apps](https://core.telegram.org/bots/webapps).  
> Do **not** link the t.co short URL in docs — use the stable URLs above.

This doc maps Canvas features to the official API so engineers know where to look when extending captcha types, join flows, or rich templates.

---

## Quick links

| Topic | Official doc |
|-------|----------------|
| Bot API index | https://core.telegram.org/bots/api |
| Webhooks + `setWebhook` | https://core.telegram.org/bots/api#setwebhook |
| Allowed updates | https://core.telegram.org/bots/api#update |
| Inline keyboards | https://core.telegram.org/bots/features#inline-keyboards |
| `InlineKeyboardButton` | https://core.telegram.org/bots/api#inlinekeyboardbutton |
| `callback_data` limit (64 bytes) | https://core.telegram.org/bots/api#inlinekeyboardbutton |
| Deep links `/start` payload (64 chars) | https://core.telegram.org/bots/features#deep-linking |
| Join requests | https://core.telegram.org/bots/api#chatjoinrequest |
| Chat permissions / restrict | https://core.telegram.org/bots/api#chatpermissions |
| Mini Apps (Web Apps) | https://core.telegram.org/bots/webapps |
| `WebAppData` / `sendData` | https://core.telegram.org/bots/api#webappdata |
| BotFather setup | https://core.telegram.org/bots#6-botfather |

---

## Canvas feature → API mapping

| Canvas feature | Bot API type / method | Our code |
|----------------|----------------------|----------|
| Webhook server | `setWebhook`, `Update` via POST | [`src/telegram/bot.ts`](../src/telegram/bot.ts) |
| Secret token validation | `secret_token` on webhook | [`src/telegram/bot.ts`](../src/telegram/bot.ts) |
| Open join → mute user | `restrictChatMember` | [`src/telegram/verification-actions.ts`](../src/telegram/verification-actions.ts) |
| Portal / join request | `chat_join_request` update, `creates_join_request` invite link | [`src/telegram/handlers/join-request.ts`](../src/telegram/handlers/join-request.ts) |
| Approve / decline join | `approveChatJoinRequest`, `declineChatJoinRequest` | [`src/telegram/verification-actions.ts`](../src/telegram/verification-actions.ts) |
| Welcome + deep link | `sendMessage` + `InlineKeyboardButton.url` | [`src/telegram/services/welcome-gate.ts`](../src/telegram/services/welcome-gate.ts) |
| `/start verify_<uuid>` | `Message` with `/start` + payload | [`src/telegram/handlers/start.ts`](../src/telegram/handlers/start.ts) |
| Trivia / preference buttons | `InlineKeyboardMarkup`, `callback_query` | [`src/telegram/handlers/captcha-callback.ts`](../src/telegram/handlers/captcha-callback.ts) |
| Open-text DM reply | `Message.text` in private chat | [`src/telegram/handlers/message.ts`](../src/telegram/handlers/message.ts) |
| Mini App captcha | `InlineKeyboardButton.web_app` → `WebAppInfo` | [`src/telegram/services/captcha-dm.ts`](../src/telegram/services/captcha-dm.ts) |
| Mini App submit | `Message.web_app_data` | [`src/telegram/handlers/message.ts`](../src/telegram/handlers/message.ts) |
| Delete unverified group msgs | `deleteMessage` | [`src/telegram/handlers/message.ts`](../src/telegram/handlers/message.ts) |

---

## Task types vs Telegram capabilities

| Canvas `task_type` | Telegram delivery | Limits (from Bot API) |
|--------------------|-------------------|------------------------|
| `trivia_mc` | Text + inline keyboard | `callback_data` ≤ 64 bytes; up to 8 buttons per row |
| `open_text` | Text prompt, user replies | Message text ≤ 4096 chars |
| `preference_mc` | Formatted text + inline buttons | Same as trivia; any tap = pass (intent signal) |
| `preference_webapp` | Text + `web_app` button | Mini App must load over HTTPS; `sendData` ≤ 4096 bytes |

See [`src/services/verification-tasks.ts`](../src/services/verification-tasks.ts) for resolver logic.

---

## Bot API 10.1 — relevant to Canvas roadmap

From the [June 2026 changelog](https://core.telegram.org/bots/api#recent-changes):

### Join Request Queries (upgrade path)

New in 10.1 for guard bots:

- `User.supports_join_request_queries` — bot can be assigned as join-request guard
- `ChatJoinRequest.query_id` — must respond within **10 seconds**
- `sendChatJoinRequestWebApp` — open Mini App during join request (native captcha canvas)
- `answerChatJoinRequestQuery` — approve/decline from query

**Today:** Canvas uses `chat_join_request` + DM verification + `approveChatJoinRequest`.  
**Future:** Assign Canvas as guard bot and use `sendChatJoinRequestWebApp` so verification runs inside a Mini App at join time (no separate DM step).

### Rich Messages (advertiser templates v2)

- `sendRichMessage`, `RichMessage`, block types (tables, lists, photos, etc.)
- Could replace plain Markdown in [`captcha-dm.ts`](../src/telegram/services/captcha-dm.ts) for structured advertiser tasks without a full Mini App

**Status:** Not implemented — track for dashboard template previews.

---

## Mini App integration checklist

Per [Initializing Mini Apps](https://core.telegram.org/bots/webapps#initializing-mini-apps):

- [ ] HTTPS URL (Railway production or `MINI_APP_BASE_URL` in `.env`)
- [ ] Call `Telegram.WebApp.ready()` on load — see [`public/mini-app/preference.html`](../public/mini-app/preference.html)
- [ ] Validate `initData` server-side if accepting auth from Mini App (not yet wired)
- [ ] Treat `web_app_data` as untrusted until tied to active `verification_id`
- [ ] Test on iOS, Android, Desktop Telegram clients

---

## Webhook configuration

Canvas registers these `allowed_updates` (see [`bot.ts`](../src/telegram/bot.ts)):

```
message, chat_member, chat_join_request, my_chat_member, callback_query
```

Add `web_app_data` is included via `message` updates — no separate update type needed.

Required BotFather settings for Canvas:

| Setting | Why |
|---------|-----|
| Group Privacy → **Disabled** | Bot receives join events and can DM users |
| Admin: Ban, Restrict, Invite via Link | Rose-style gating |
| Webhook URL + secret | Production on Railway |

---

## Local copy of Bot API doc

A full markdown export of the Bot API is available at:

`~/.cursor/projects/Users-matthewmeakin-canvas-ai/uploads/zgzPOOUJF5-0.md`

Use for offline search only. **Always prefer [core.telegram.org/bots/api](https://core.telegram.org/bots/api) in committed docs** — it stays current via @BotNews.

---

## When to read which doc

| Question | Read |
|----------|------|
| How do inline buttons work? | [Inline keyboards](https://core.telegram.org/bots/features#inline-keyboards) |
| How far can captcha UI go in chat? | This file → Task types table |
| Rich cards / drag-rank UI? | [Mini Apps](https://core.telegram.org/bots/webapps) |
| Join portal + approve flow? | [ChatJoinRequest](https://core.telegram.org/bots/api#chatjoinrequest) |
| Advertiser deposits + escrow? | [`BUILD_PLAN.md`](../BUILD_PLAN.md) payments v0 section |
| Bankr onramp for advertisers? | [@bankr_ai_bot](https://t.me/bankr_ai_bot) + `npm run bankr:spike` |
| Advertiser dashboard + API? | [`DASHBOARD_MVP.md`](./DASHBOARD_MVP.md) |
| Implementation status? | [`BUILD_PLAN.md`](../BUILD_PLAN.md) |
