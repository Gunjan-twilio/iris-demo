# IRIS Walmart Demo — Project Guide

## What This Is
Headless Twilio Flex SDK customer support platform for Walmart sellers. Associates handle inbound chat, phone, and email tasks from a React CRM. Sellers submit support requests via a separate React portal.

**Deployed URL:** https://iris-demo-2775-dev.twil.io
- Associate panel: `/#/associate` — requires SSO login; runtime domain: `busy-anteater-9071.twil.io`
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
- `create-task.js` — creates TaskRouter task for all 4 channels
- `initialize-accepted-chat.js` — called on associate accept for chat: creates Conversation, adds both participants, stamps `conversationSid` onto task attributes and Airtable
- `accept-reservation.js` — updates Airtable case status to `wip`
- `call-now-ivr.js` — TwiML IVR for Call Now: plays greeting, captures digit 1, `<Enqueue>`s caller into TaskRouter with task attributes
- `call-now-wait.js` — hold music TwiML served while seller waits in queue
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
| Worker (SSO) | see TaskRouter console — identity derived from `contact_uri` |
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
- On accept: `initialize-accepted-chat` endpoint creates Conversation, adds `sellerEmail` + worker identity as participants, stamps `conversationSid` onto task attrs and Airtable
- Worker identity is derived dynamically from `worker.attributes.contact_uri.replace('client:', '')` — not hardcoded
- **Race condition handled:** `attachReservationListeners` `accepted` event may fire before `initialize-accepted-chat` returns — `setOpenCases` merges `conversationSid` into existing entry instead of deduping
- Seller `ChatWindow` only renders once Airtable poll sees a populated `conversation_sid`
- Both sides connect to Conversation via `seller-token` endpoint + `ConversationsClient.create()`

### Email
- Uses Flex Interactions API (`client.flexApi.v1.interaction.create`) with `type: 'email'`
- Channel and Routing params must be **pre-stringified JSON** passed as strings — SDK form-path serialization otherwise breaks the Flex v1 API
- Routing properties must use **snake_case** keys: `workspace_sid`, `workflow_sid`, `task_channel_unique_name`

### Call Now
- `create-task.js` places an outbound call to `seller_phone` with TwiML pointing at `call-now-ivr`
- IVR greets seller, waits for digit 1, then `<Enqueue workflowSid>` puts the live call into TaskRouter with task attributes (`skill`, `channel: call_now`, `case_id`, etc.)
- Hold music plays from `call-now-wait` while seller waits
- Associate accepts via `reservation.dequeue()` — NOT `AcceptTask` or `reservation.accept()`
  - `dequeue()` tells Twilio to dial `client:WORKER_IDENTITY` and bridge the enqueued call to it
- `AddVoiceEventListener` is registered once at init (in `AssociatePanel` `init()`) using the Flex token's built-in VoiceGrant — no separate voice token needed
- On accept: set `pendingCallNowCaseIdRef` to the case_id, then call `dequeue()`. The init-time listener fires when the VoiceCall arrives and pairs it with the case via the ref
- Worker identity (`contact_uri` with `client:` stripped) is used as the `to` target for `dequeue()`

---

## Known SDK Behaviors

- `flexClient` is a plain EventEmitter with only `['_events', '_eventsCount', '_maxListeners']` — no internal Conversations client exposed
- `flexClient.voice` is always `undefined` — the Flex SDK does NOT expose a voice property on the client object
- Voice Device is **lazy-initialized** only when `AddVoiceEventListener` or `StartOutboundCall` is executed via `flexClient.execute()`
- The Flex JWE token DOES contain a VoiceGrant — `AddVoiceEventListener` works without a custom Device or separate token
- `GetConversationByTask` only works for Interactions API tasks — NOT for plain TaskRouter tasks
- `AcceptTask` creates a voice conference via event bridge — throws error `48910` on chat/email tasks; use `reservation.accept()` for those
- `AcceptTask` also fails on `<Enqueue>` voice tasks (Call Now) — use `reservation.dequeue()` instead
- `reservationCreated` fires for ALL tasks including outbound voice tasks spawned by `StartOutboundCall`
- Stale reservations on refresh: filter with `if (res.status !== 'pending') return`
- `autoAcceptIncomingCalls: true` in `voiceOptions` defaults to true — the SDK auto-accepts incoming calls on the internal voice controller

---

## Airtable

- Base ID: `appeJOuUh0S8pP6aT`
- Table: `Cases`
- Valid `help_category` values: `payments`, `listings`
- Valid `channel` values: `chat`, `phone`, `email`, `call_now`
- Valid `status` values: `new`, `wip`, `needs_info`, `resolved`

---

## Git Tags
- `v1.0` — initial working build
- `voice-working` — voice flow stable
- `chat-working` — chat flow working
- `chat-email-working` — all three channels working
- `all-channels-working` — all four channels working including Call Now audio bridge
