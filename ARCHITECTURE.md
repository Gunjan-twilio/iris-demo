# IRIS Walmart Demo — Architecture

---

## Channel Flows

### Chat Flow
1. Seller fills form (name, email, help category, channel=chat) → hits Submit
2. `SellerPanel` calls `create-webchat-interaction` directly — this creates a Conversation in the Flex Conversations Service, triggers a Studio Flow, and enqueues a TaskRouter task via the Flex Interactions API. An Airtable record is created with status `new`.
3. Seller is immediately placed in a live chat window (`WebchatWidget`) — no wait for associate accept
4. TaskRouter finds an available associate and creates a Reservation
5. `assignment-callback` fires: stamps `task_sid` and `reservation_sid` onto the Airtable case
6. Associate's browser receives the reservation via the Flex SDK `reservationCreated` event (WebSocket — no polling)
7. Associate sees an incoming task card with Accept / Reject and a 20-second countdown
8. Associate clicks Accept → `accept-reservation` marks the case `wip` in Airtable; associate side opens `AssociateChatPanel` using `GetConversationByTask`

### Phone Callback Flow
1. Seller fills form with channel=phone and their phone number → hits Submit
2. `create-task.js` creates a plain TaskRouter task + Airtable record
3. Steps 4–7 same as Chat above
4. Associate clicks Accept → `AcceptTask` (Flex SDK) accepts the reservation and creates a voice conference; `StartOutboundCall` dials the seller's number and bridges them in
5. Associate sees `PhoneControls` (mute, hold, end)

### Email Flow
1. Seller fills form with channel=email → hits Submit
2. `create-task.js` creates a TaskRouter task via the Flex Interactions API with `type: email`; Airtable record created
3. Steps 3–7 same as Chat above
4. Associate clicks Accept → `accept-reservation` marks case `wip`; associate side opens `EmailThreadView`, which uses `GetConversationByTask` to connect to the email thread
5. Associate can reply using Handlebars templates (`get-templates`, `render-template`) or compose freeform

### Call Now Flow
1. Seller fills form with channel=call_now and their phone number → hits Submit
2. `create-task.js` places an outbound call to the seller with TwiML pointing at `call-now-ivr`
3. IVR greets seller, waits for digit 1, then `<Enqueue workflowSid>` puts the live call into TaskRouter; hold music plays from `call-now-wait`
4. TaskRouter finds an available associate and creates a Reservation
5. `assignment-callback` stamps task/reservation SIDs onto Airtable
6. Associate clicks Accept → a `VoiceGrant` token is fetched from `voice-token`, a `@twilio/voice-sdk` `Device` is registered in the browser, `voiceDevice.on('incoming', call => call.accept())` auto-answers; `reservation.dequeue()` bridges the enqueued call to `client:WORKER_IDENTITY`
7. Associate sees `PhoneControls`

---

## Twilio Functions (Backend)

### Auth / Token

#### `token.js`
Build-your-own-auth: mints a Flex v4 JWE token for a given `flex_user_sid` via the Flex Users API (`POST /Users/{flex_user_sid}/Tokens`). Called by `App.jsx`'s login form, which collects the Flex User SID directly instead of going through SSO.

#### `seller-token.js`
Mints a standard AccessToken with a `ChatGrant` for any identity. Used by both seller and associate to connect to the Conversations SDK.

#### `voice-token.js`
Mints a standard AccessToken with a `VoiceGrant` (including TwiML App SID) for browser Device registration. Used exclusively by the Call Now accept flow.

---

### Task Creation

#### `create-task.js`
Called by `SellerPanel` for phone, email, and call_now channels. Creates a TaskRouter task with attributes (`skill`, `channel`, `seller_name`, `case_id`, `seller_phone`, etc.) and an Airtable record with status `new`. For call_now, also places the outbound call to the seller.

#### `create-webchat-interaction.js`
Called by `WebchatWidget` for the chat channel. Creates a Conversation in the Flex Conversations Service, triggers a Studio Flow (`FWe006e2c7a05b89dd260d4d7f2e90c7c7`) which routes the interaction through the Flex Interactions API into TaskRouter. Also creates an Airtable record.

---

### Reservation Lifecycle

#### `assignment-callback.js`
TaskRouter workspace Assignment Callback URL. Called by Twilio (not the frontend) when a task is assigned. Stamps `task_sid`, `reservation_sid`, and (for email) `conversation_sid` onto the Airtable case. Returns an empty instruction — the associate UI handles accept/reject.

#### `accept-reservation.js`
Called when the associate accepts a reservation. Updates Airtable case status to `wip`.

#### `initialize-accepted-chat.js`
Legacy function for non-webchat chat accept path. Creates a Conversation, adds seller and worker as participants, stamps `conversationSid` onto task attributes and Airtable.

#### `resolve-case.js`
Marks a case `resolved` in Airtable.

---

### Voice / TwiML

#### `voice-handler.js`
TwiML endpoint configured as the TwiML App Voice Request URL. Used by the phone callback channel to bridge the outbound call to the associate's browser client.

#### `call-now-ivr.js`
TwiML IVR for the Call Now channel. Plays a greeting, waits for digit 1, then uses `<Enqueue workflowSid>` to put the live call into TaskRouter with task attributes.

#### `call-now-wait.js`
Hold music TwiML served to the seller while waiting in the TaskRouter queue.

---

### Case Data

#### `get-case.js`
Polls a single case by `case_id`. Returns `conversation_sid`, `status`, `seller_phone`, etc. Used by `SellerPanel` to detect when the associate has accepted.

#### `get-seller-cases.js`
Returns all cases for a given seller email. Used by `SellerPanel` to show case history.

#### `get-associate-cases.js`
Returns recent cases for the associate home panel.

#### `get-active-case.js`
Returns the most recent `wip` case assigned to the associate. Used to restore state on refresh.

#### `get-case-interactions.js`
Returns interaction history (chat, email, phone) for a given `case_id`. Used by `CaseHistory`.

#### `get-queue-count.js`
Returns the current number of tasks waiting in the TaskRouter queue. Displayed on the associate home panel.

---

### Email / Templates

#### `get-templates.js`
Fetches named email templates from the Airtable `Templates` table.

#### `render-template.js`
Renders a Handlebars template with case context variables (`seller_name`, `case_summary`, `help_category`, `seller_email`, etc.). Returns rendered HTML.

---

## React Components (Frontend)

### `App.jsx`
Entry point. Handles login — the associate enters their Flex User SID, which is exchanged for a token via `token.js`, then initializes the Flex SDK client via `createClient()` and passes `flexClient` to `AssociatePanel`. Routes `/#/associate` and `/#/seller`.

### `AssociatePanel.jsx`
Main associate CRM. Responsibilities:
- Worker status management (Available, Break, Lunch, etc.) via `SetCurrentActivity`
- Listens for `reservationCreated` events from the Flex SDK
- Shows pending reservation overlay with Accept / Reject and 20-second countdown
- Manages open case tabs (`openCases` state)
- On accept, routes to the correct channel handler:
  - **chat** — `AssociateChatPanel` via `GetConversationByTask`
  - **phone** — `AcceptTask` + `StartOutboundCall` + `PhoneControls`
  - **email** — `AcceptTask` + `EmailThreadView`
  - **call_now** — fetches voice token, registers `Device`, calls `reservation.dequeue()`, `PhoneControls`
- Home tab shows queue count, recent cases, search/filter via `CaseHistory`

### `SellerPanel.jsx`
Seller portal. Responsibilities:
- Case submission form (help category, channel, phone number, summary)
- For chat: opens `WebchatWidget` immediately on submit
- For other channels: calls `create-task`, then polls `get-case` for status updates
- Shows live case list with status badges
- Opens case detail view with channel-appropriate UI

### `WebchatWidget.jsx`
Seller-side webchat component. Calls `create-webchat-interaction` on mount to establish a Flex Interactions session, then renders `ChatWindow` once a `conversationSid` is returned.

### `ChatWindow.jsx`
Shared chat UI used by both seller (`WebchatWidget`) and associate (`AssociateChatPanel`). Connects to a Conversation via `seller-token` + `ConversationsClient.create()`. Loads message history, listens for new messages, sends messages.

### `AssociateChatPanel.jsx`
Associate-side chat panel for Interactions API tasks. Uses `GetConversationByTask` (Flex SDK action) to retrieve the conversation by `taskSid`, then renders `ChatWindow`.

### `EmailThreadView.jsx`
Associate-side email thread view. Uses `GetConversationByTask` to connect to the email thread. Supports template-based replies (fetches from `get-templates`, renders via `render-template`) and freeform compose. Messages are sent via the Conversations SDK.

### `CaseHistory.jsx`
Case history component rendered in the associate home tab. Shows interaction history across channels (email, phone, chat) by calling `get-case-interactions`. Supports email compose to start a new outbound thread on an existing case.

### `PhoneControls.jsx`
Associate-only voice controls. Exposes Mute, Hold, and End Call using the `VoiceCall` object captured via `AddVoiceEventListener`.

### `OutboundDialer.jsx` / `OutboundDialerModal.jsx`
E.164 phone number input with a dial pad. `OutboundDialerModal` wraps `OutboundDialer` in a toggle modal. Used in the associate panel for manual outbound dialing.

---

## Key Design Decisions

**Headless Flex SDK:** The associate's browser connects directly to TaskRouter via the Flex SDK — reservations are pushed over a WebSocket with no polling. There is no Flex hosted UI; all UI is custom React with full ownership of layout and behavior.

**Chat via Interactions API:** The chat channel uses the Flex Interactions API (via Studio Flow) rather than a plain TaskRouter task. This gives the seller an immediate chat session before an associate accepts, and ensures the conversation is managed under the Flex Conversations Service.

**Call Now via `reservation.dequeue()`:** Unlike phone callback (which uses `AcceptTask` + `StartOutboundCall`), Call Now uses `reservation.dequeue()` to bridge the already-enqueued live call to the associate's browser Voice Device. A separate VoiceGrant token must be minted because the Flex JWE token does not include a VoiceGrant.

**`assignment-callback` as the SID bridge:** The TaskRouter assignment callback is the only reliable place to capture `task_sid` and `reservation_sid` at assignment time and write them to Airtable, where the associate frontend can poll for them.

---

## File Structure

```
iris-walmart-demo/
├── .env                               # credentials (never committed)
├── .env.example                       # template
├── .nvmrc                             # Node 22
├── .gitignore
├── package.json                       # root deploy script (dotenv-cli)
├── SETUP.md
├── ARCHITECTURE.md                    # this file
├── functions/                         # Twilio Serverless Functions
│   ├── package.json
│   ├── .env                           # copy of root .env for deploy
│   └── functions/
│       ├── token.js
│       ├── seller-token.js
│       ├── voice-token.js
│       ├── create-task.js
│       ├── create-webchat-interaction.js
│       ├── assignment-callback.js
│       ├── accept-reservation.js
│       ├── initialize-accepted-chat.js
│       ├── voice-handler.js
│       ├── call-now-ivr.js
│       ├── call-now-wait.js
│       ├── resolve-case.js
│       ├── get-case.js
│       ├── get-seller-cases.js
│       ├── get-associate-cases.js
│       ├── get-active-case.js
│       ├── get-case-interactions.js
│       ├── get-queue-count.js
│       ├── get-templates.js
│       └── render-template.js
└── frontend/                          # React + Vite
    ├── package.json
    ├── .env                           # VITE_ prefixed vars (never committed)
    ├── .env.example                   # template
    └── src/
        ├── App.jsx
        ├── main.jsx
        ├── index.css
        └── components/
            ├── AssociatePanel.jsx
            ├── AssociateChatPanel.jsx
            ├── CaseHistory.jsx
            ├── ChatWindow.jsx
            ├── EmailThreadView.jsx
            ├── OutboundDialer.jsx
            ├── OutboundDialerModal.jsx
            ├── PhoneControls.jsx
            ├── SellerPanel.jsx
            └── WebchatWidget.jsx
```
