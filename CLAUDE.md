# IRIS Walmart Demo — Project Guide

## What This Is
Headless Twilio Flex SDK customer support platform for Walmart sellers. Associates handle inbound chat, phone, and email tasks from a React CRM. Sellers submit support requests via a separate React portal.

**Deployed URL:** https://iris-demo-2775-dev.twil.io
- Associate panel: `/#/associate`
- Seller panel: `/#/seller`

---

## Architecture

### Frontend (`frontend/`)
- React + Vite
- `App.jsx` — initializes `flexClient` via `createClient()` from `@twilio/flex-sdk`, passes to `AssociatePanel`
- `AssociatePanel.jsx` — main associate CRM: reservation handling, task accept/reject, case tabs
- `SellerPanel.jsx` — seller portal: submit tasks, poll Airtable for case updates, chat window
- `ChatWindow.jsx` — shared chat component; both sides use `seller-token` endpoint with their identity
- Build command: `cd frontend && npm run build` — copies `dist/*` to `functions/assets/`

### Backend (`functions/functions/`)
Twilio Serverless Functions. Deploy from `functions/` directory.

Key functions:
- `token.js` — mints Flex token for associate via Flex v4 Users API
- `seller-token.js` — mints standard AccessToken with `ChatGrant` for any identity (used by both seller and associate for Conversations SDK)
- `create-task.js` — creates TaskRouter task for all 3 channels
- `initialize-accepted-chat.js` — called on associate accept for chat: creates Conversation, adds both participants, stamps `conversationSid` onto task attributes and Airtable
- `accept-reservation.js` — updates Airtable case status to `wip`
- `get-seller-cases.js` — seller polls this; returns `seller_phone` field
- `resolve-case.js` — marks case resolved

---

## Deploy Workflow

**Always build frontend first, then deploy:**
```bash
cd frontend && npm run build
cd ../functions && twilio serverless:deploy --override-existing-project --profile "Retail flex-sdk"
```

**Active Twilio CLI profile:** `Retail flex-sdk`
- Account: `AC256a40490cd6e3e0da6abea27bbd1ab1`
- Do NOT use other profiles — wrong account

---

## Key Twilio SIDs

| Resource | SID |
|---|---|
| Workspace (Flex) | `WSe1efb8c6590e11c6141f6aac9c23df97` |
| Workflow | `WWe2b75d2d19c759cf5d587a9095e9f475` |
| Worker (associate1) | `WK0661efe194e06fd43a88866fbe1562ba` |
| Conversations Service | `ISdb559a91e4f148f8841b03e42a03a2a7` (**Flex Conversation Service** — NOT `retail-conversations`) |
| TwiML App | `AP8357031085f0c552c6cdf59ac9cb2208` |
| Phone Number | `+19714552092` |

**Important:** The Flex Interactions API always creates conversations under the **Flex Conversation Service** (`ISdb559a91e4f148f8841b03e42a03a2a7`). The old `IS51728a4d336f4334b2ad6a44d63c7887` (retail-conversations) is unused.

---

## Channel Architecture

### Phone
- `create-task.js` creates a plain TaskRouter task on `default` channel
- Associate accepts via `AcceptTask` (creates voice conference)
- `StartOutboundCall` dials the seller — fires a second `reservationCreated` event
- Outbound reservation filtered in `handleReservation` by `attrs.direction === 'outbound'` — auto-completed on `wrapup`
- `isDialingRef` guard prevents double-dial on React re-render

### Chat
- `create-task.js` creates a plain TaskRouter task on `chat` channel, `conversationSid: ''`
- On accept: `initialize-accepted-chat` endpoint creates Conversation, adds `sellerEmail` + `associate1` as participants, stamps `conversationSid` onto task attrs and Airtable
- **Race condition handled:** `attachReservationListeners` `accepted` event may fire before `initialize-accepted-chat` returns — `setOpenCases` merges `conversationSid` into existing entry instead of deduping
- Seller `ChatWindow` only renders once Airtable poll sees a populated `conversation_sid`
- Both sides connect to Conversation via `seller-token` endpoint + `ConversationsClient.create()`

### Email
- Uses Flex Interactions API (`client.flexApi.v1.interaction.create`) with `type: 'email'`
- Channel and Routing params must be **pre-stringified JSON** passed as strings — SDK form-path serialization otherwise breaks the Flex v1 API
- Routing properties must use **snake_case** keys: `workspace_sid`, `workflow_sid`, `task_channel_unique_name`

---

## Known SDK Behaviors

- `flexClient` is a plain EventEmitter with only `['_events', '_eventsCount', '_maxListeners']` — no internal Conversations client exposed
- `GetConversationByTask` only works for Interactions API tasks — NOT for plain TaskRouter tasks
- `AcceptTask` creates a voice conference via event bridge — throws error `48910` on chat/email tasks; use `reservation.accept()` for those
- `reservationCreated` fires for ALL tasks including outbound voice tasks spawned by `StartOutboundCall`
- Stale reservations on refresh: filter with `if (res.status !== 'pending') return`

---

## Airtable

- Base ID: `appeJOuUh0S8pP6aT`
- Table: `Cases`
- Valid `help_category` values: `payments`, `listings`
- Valid `channel` values: `chat`, `phone`, `email`
- Valid `status` values: `new`, `wip`, `needs_info`, `resolved`

---

## Git Tags
- `v1.0` — initial working build
- `voice-working` — voice flow stable
- `chat-working` — chat flow working
- `chat-email-working` — all three channels working
