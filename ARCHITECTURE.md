# IRIS Walmart Demo — Architecture

---

## The Full Flow

### Chat Flow
1. Seller fills a form (name, help category, channel=chat) → hits Submit
2. Backend creates a **TaskRouter task** with attributes `{skill: "payments", channel: "chat"}`
3. TaskRouter finds Associate-1 (who is Available) and creates a **Reservation**
4. Associate's browser receives the reservation automatically via the **TaskRouter Worker JS SDK** — no polling, it's a live WebSocket connection
5. Associate sees an incoming task card with Accept / Reject and a 20-second countdown
6. Associate clicks Accept → backend accepts the reservation, creates a **Conversations conversation**, adds both seller and associate as participants
7. Both sides now have a live chat window

### Phone Flow
1. Same as steps 1–5 above but channel=phone, seller also provides their phone number
2. Associate clicks Accept → backend accepts the reservation, initiates an **outbound call** to the seller's phone number
3. That call bridges through to the associate's **browser** via the Voice JS SDK
4. Associate sees phone controls (mute, hold, end)

---

## Twilio Functions (Backend)

### `token.js`
Generates a single access token for the associate's browser with three grants:
- **TaskRouter Worker grant** — lets the browser SDK receive reservations via WebSocket
- **Conversations grant** — lets the browser join chat conversations
- **Voice grant** (with TwiML App SID) — lets the browser make/receive calls

### `create-task.js`
Called when the seller submits the form. Does two things:
- Creates a TaskRouter task with `skill`, `channel`, `seller_name`, `case_id`, and `seller_phone` as task attributes
- Creates an Airtable record with status `new`

Returns a `case_id` to the seller's browser.

### `accept-reservation.js`
Called when the associate clicks Accept. Behavior varies by channel:
- **Both channels:** Accepts the TaskRouter reservation via REST, updates Airtable status to `wip`
- **Chat:** Creates a Conversations conversation, adds associate and seller as participants, returns `conversation_sid`
- **Phone:** Initiates an outbound Twilio call to the seller's phone number — bridges into the associate's browser client

### `reject-reservation.js`
Called when associate clicks Reject or the 20-second timeout fires. Rejects the reservation — TaskRouter automatically finds the next available worker.

### `voice-handler.js`
TwiML endpoint. When the outbound call to the seller connects, Twilio hits this URL. Returns:
```xml
<Response>
  <Dial>
    <Client>associate1</Client>
  </Dial>
</Response>
```
This bridges the seller's phone call into the associate's browser.

### `get-case.js`
Polling endpoint. Seller's browser calls this every 2 seconds with their `case_id`. Once the associate accepts and a `conversation_sid` exists in Airtable, it returns it — that's the signal for the seller's panel to open the chat window.

---

## React Components (Frontend)

### `App.jsx`
Two-panel side-by-side layout. Left = seller, right = associate. On load, fetches an access token from `/token` for the associate panel.

### `SellerPanel.jsx`
- Form: seller name, help category dropdown, channel toggle (chat / phone), phone number field (appears only if phone selected)
- On submit: calls `/create-task`, stores the returned `case_id`, starts polling `/get-case`
- Once conversation SID comes back: renders `ChatWindow`
- If phone: shows "An associate will call you back shortly"

### `AssociatePanel.jsx`
- Status toggle: Offline → Available (calls `worker.updateActivity()` on the TaskRouter Worker SDK)
- Listens for `reservation.created` events from the Worker SDK
- Shows incoming task card: seller name, help category, channel — with Accept / Reject buttons and a 20-second countdown
- On Accept (chat): calls `/accept-reservation`, gets conversation SID, renders `ChatWindow`
- On Accept (phone): calls `/accept-reservation`, Voice JS SDK handles the call, renders `PhoneControls`

### `ChatWindow.jsx`
Shared by both seller and associate panels. Takes `conversationSid` and `identity` as props. Uses the Conversations JS SDK to:
- Load message history
- Listen for new incoming messages
- Send messages

### `PhoneControls.jsx`
Associate-only. Uses the Voice JS SDK device object to expose Mute, Hold, and End Call buttons.

---

## Key Design Decision

The associate's browser connects directly to TaskRouter via the **Worker JS SDK** — reservations are pushed to the browser in real time over a WebSocket. This is the core of the headless Flex SDK approach. There is no Flex UI — just raw SDK events handled in React. This is exactly the architecture Walmart needs for IRIS: Twilio as the routing and media engine, with full ownership of the UI.

---

## File Structure

```
iris-walmart-demo/
├── .env                        # credentials (never committed)
├── .env.example                # template
├── .gitignore
├── SETUP.md                    # step-by-step setup guide
├── ARCHITECTURE.md             # this file
├── test-setup.js               # verifies all services are configured
├── functions/                  # Twilio Functions service
│   ├── package.json
│   ├── .env                    # copy of root .env for serverless deploy
│   └── functions/
│       ├── token.js
│       ├── create-task.js
│       ├── accept-reservation.js
│       ├── reject-reservation.js
│       ├── voice-handler.js
│       └── get-case.js
└── frontend/                   # React + Vite app
    ├── package.json
    └── src/
        ├── App.jsx
        └── components/
            ├── SellerPanel.jsx
            ├── AssociatePanel.jsx
            ├── ChatWindow.jsx
            └── PhoneControls.jsx
```
