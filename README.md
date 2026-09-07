# IRIS — Headless Flex SDK Demo

A customer support platform for Walmart Marketplace sellers built on the **Twilio Flex JavaScript SDK in headless mode**. Associates handle inbound chat, phone, and email tasks from a custom React CRM. Sellers submit support requests via a branded seller portal.

This demonstrates how to build a fully custom contact center UI using Twilio's routing and media engine (TaskRouter, Conversations, Voice) without the Flex hosted UI.

---

## What's included

| Channel | Description |
|---|---|
| **Chat** | Real-time webchat via Flex Interactions API + Twilio Conversations SDK |
| **Phone Callback** | Seller requests a callback — associate accepts, outbound call bridges both parties |
| **Call Now** | Seller requests an immediate call — IVR connects them to hold queue, associate accepts and is bridged in |
| **Email (OOTB)** | `channel: email`. Pure Flex Interactions API — Twilio owns inbound MX, outbound dispatch, and threading. From/Reply-To is a Twilio-managed address on your Flex email domain. Simplest path when the customer accepts Twilio-hosted email infra end-to-end. |
| **Email (Hybrid)** | `channel: email_hybrid`. Flex Interactions API for inbound (Twilio-managed projected_address ingestion) + custom SendGrid outbound intercept for branded `From: support@yourdomain`. Preserves Twilio-managed threading and reporting while letting the seller see a branded sending address. Pattern adapted from [`varun-maun-twilio/plugin-flex-email-custom-smtp`](https://github.com/varun-maun-twilio/plugin-flex-email-custom-smtp) — the outbound "participants dance" (remove → send via SDK → external dispatch → re-add) is the same; we swap their frontend SMTP relay for a server-side SendGrid Mail Send call. Reply routing uses a TEMP In-Reply-To interceptor via Studio Flow + Twilio Sync (see `intercept-reply.js` and CLAUDE.md's Email Hybrid section — remove once Twilio ships native In-Reply-To routing). |
| **Email (Custom)** | `channel: email_forwarded`. Fully custom email plane. SendGrid Inbound Parse (on `parse.yourdomain.com`) → external Express receiver (see `inbound-parse-receiver/`) → relay to a Twilio Function → append to a plain Conversation. Outbound sends via SendGrid API. Chosen when the customer cannot cede any DNS/MX to Twilio (e.g. Walmart's `walmart.com` root MX constraint per the July 2026 solution PDF pages 5–6). |

**Associate CRM features:**
- Build-your-own-auth login via Flex v4 Auth (Flex User SID → minted token)
- Real-time reservation alerts with accept/reject + countdown timer
- Dynamic worker status (Available, Break, Lunch, Training, etc.)
- Case tabs with chat, email thread, and phone controls
- Case history with search and filter

**Seller portal features:**
- Walmart Seller Center branded UI
- Submit cases across all 4 channels
- Real-time case status polling
- Instant webchat session on chat submit (Flex Interactions API — no wait for accept)

---

## Architecture

```
                                             ┌─ create-webchat-interaction ─► Flex Interactions API
Seller Portal ──► create-task ──► TaskRouter ─┤                                       │
                                             └─────────────────────────────► reservationCreated event
                                                                                       │
                                                                              Associate CRM (Flex SDK)
                                                                                       │
                                                                                  Accept / Reject
                                                                                       │
                                                          ┌────────────────────────────┼───────────────────────┐
                                                        Chat                     Phone/Call Now              Email
                                                          │                            │                        │
                                                    Conversations             Voice Conference /         Interactions API
                                                        SDK                   reservation.dequeue()      (email thread)
```

**Chat** takes a separate path: `SellerPanel` calls `create-webchat-interaction` directly (Flex Interactions API via Studio Flow), bypassing `create-task`. The seller enters the chat room immediately; the associate side receives a reservation via the normal `reservationCreated` event.

**Email is three side-by-side channels** (`email`, `email_hybrid`, `email_forwarded`) so you can demo the trade-offs of "Twilio owns email" vs "we own outbound only" vs "we own the entire email plane." See CLAUDE.md's Channel Architecture section for the participants dance, the projected_address anchor, and the TEMP In-Reply-To interceptor pattern the hybrid variant needs (until Twilio adds native routing).

See [ARCHITECTURE.md](ARCHITECTURE.md) for a detailed breakdown of every component.

---

## Quick Start

### Prerequisites

- Node.js 22 (matches Twilio Serverless runtime)
- Twilio CLI: `npm install -g twilio-cli`
- Twilio Serverless plugin: `twilio plugins:install @twilio-labs/plugin-serverless`
- Twilio account with Flex enabled
- Airtable account

### 1. Clone and configure

```bash
git clone <repo-url>
cd iris-walmart-demo
cp .env.example .env
```

Fill in all values in `.env` — see [SETUP.md](SETUP.md) for where to find each one.

### 2. Copy env to functions

```bash
cp .env functions/.env
```

### 3. Install dependencies

```bash
npm install              # root (deploy script)
cd frontend && npm install
```

### 4. Deploy

```bash
cd ..
npm run deploy
```

This builds the frontend and deploys everything to Twilio Serverless in one command.

### 5. Update TwiML App URL

After first deploy, update your TwiML App's Voice Request URL to:
```
https://<your-domain>.twil.io/voice-handler
```

---

## Project Structure

```
iris-walmart-demo/
├── .env                          # credentials (never committed)
├── .env.example                  # template — copy this to .env
├── package.json                  # root deploy script
├── SETUP.md                      # detailed step-by-step setup guide
├── ARCHITECTURE.md               # component and flow documentation
├── functions/                    # Twilio Serverless Functions
│   ├── .env                      # copy of root .env (needed for deploy)
│   ├── package.json
│   └── functions/
│       ├── token.js                      # Flex v4 token for associate (build-your-own-auth)
│       ├── seller-token.js               # Conversations token for seller
│       ├── voice-token.js                # VoiceGrant token for browser Device (Call Now)
│       ├── create-task.js                # creates TaskRouter task + Airtable record (phone/email/call_now)
│       ├── create-webchat-interaction.js # Flex Interactions API webchat session (chat channel)
│       ├── assignment-callback.js        # TaskRouter callback; stamps task/reservation SIDs onto Airtable
│       ├── accept-reservation.js         # marks case wip in Airtable
│       ├── initialize-accepted-chat.js   # creates Conversation on chat accept (non-webchat path)
│       ├── voice-handler.js              # TwiML for phone callback bridge
│       ├── call-now-ivr.js               # TwiML IVR for Call Now: gather digit, <Enqueue>
│       ├── call-now-wait.js              # hold music TwiML while seller waits in queue
│       ├── resolve-case.js               # marks case resolved
│       ├── get-seller-cases.js           # seller polls for their cases
│       ├── get-case.js                   # polls a single case (conversation_sid)
│       ├── get-active-case.js            # finds the current wip case for the associate
│       ├── get-associate-cases.js        # recent case list for associate home panel
│       ├── get-case-interactions.js      # interaction history for a case (used by CaseHistory)
│       ├── get-queue-count.js
│       ├── get-templates.js              # email templates from Airtable Templates table
│       └── render-template.js            # renders a Handlebars template with case variables
└── frontend/                     # React + Vite
    ├── .env                      # VITE_ prefixed vars
    └── src/
        ├── App.jsx               # Flex User SID login + routing
        └── components/
            ├── AssociatePanel.jsx
            ├── SellerPanel.jsx
            ├── ChatWindow.jsx
            ├── AssociateChatPanel.jsx
            ├── CaseHistory.jsx           # case history with interaction tabs and email compose
            ├── EmailThreadView.jsx
            ├── OutboundDialer.jsx        # E.164 dial pad input
            ├── OutboundDialerModal.jsx   # modal wrapper for OutboundDialer
            ├── PhoneControls.jsx
            └── WebchatWidget.jsx         # seller-side webchat via create-webchat-interaction
```

---

## URLs (after deploy)

| Page | URL |
|---|---|
| Seller portal | `https://<domain>/index.html#/seller` |
| Associate CRM | `https://<domain>/index.html#/associate` |

---

## Key env vars

See `.env.example` for the full list. The most important ones:

| Variable | Description |
|---|---|
| `ACCOUNT_SID` / `AUTH_TOKEN` | Twilio account credentials |
| `WORKSPACE_SID` | TaskRouter workspace |
| `WORKFLOW_SID` | TaskRouter workflow for routing |
| `CONVERSATIONS_SERVICE_SID` | **Must be the Flex Conversation Service** — not a custom one |
| `TWIML_APP_SID` | TwiML App for browser Voice SDK |
| `TWILIO_PHONE_NUMBER` | Voice-capable number for outbound calls |

---

## Deploying changes

```bash
npm run deploy
```

Run from the repo root. Builds frontend and deploys functions in one step. Credentials are read from `.env` at the repo root — no Twilio CLI profile needed.
