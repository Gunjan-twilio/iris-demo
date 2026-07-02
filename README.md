# IRIS — Headless Flex SDK Demo

A customer support platform for Walmart Marketplace sellers built on the **Twilio Flex JavaScript SDK in headless mode**. Associates handle inbound chat, phone, and email tasks from a custom React CRM. Sellers submit support requests via a branded seller portal.

This demonstrates how to build a fully custom contact center UI using Twilio's routing and media engine (TaskRouter, Conversations, Voice) without the Flex hosted UI.

---

## What's included

| Channel | Description |
|---|---|
| **Chat** | Real-time chat via Twilio Conversations SDK |
| **Phone Callback** | Seller requests a callback — associate accepts, outbound call bridges both parties |
| **Call Now** | Seller requests an immediate call — IVR connects them to hold queue, associate accepts and is bridged in |
| **Email** | Full email threading via Flex Interactions API — replies from inbox or portal both append to the same thread |

**Associate CRM features:**
- SSO login via Flex v4 Auth
- Real-time reservation alerts with accept/reject + countdown timer
- Dynamic worker status (Available, Break, Lunch, Training, etc.)
- Case tabs with chat, email thread, and phone controls
- Case history with search and filter

**Seller portal features:**
- Walmart Seller Center branded UI
- Submit cases across all 4 channels
- Real-time case status polling
- Live chat window once associate accepts

---

## Architecture

```
Seller Portal ──► create-task ──► TaskRouter ──► reservationCreated event
                                                        │
                                               Associate CRM (Flex SDK)
                                                        │
                                                   Accept / Reject
                                                        │
                                    ┌───────────────────┼────────────────────┐
                                  Chat              Phone/Call Now         Email
                                    │                   │                   │
                              Conversations       Voice Conference    Interactions API
                                  SDK               (TwiML)           (email thread)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for a detailed breakdown of every component.

---

## Quick Start

### Prerequisites

- Node.js 18+
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
│       ├── token.js              # Flex v4 SSO token for associate
│       ├── seller-token.js       # Conversations token for seller
│       ├── create-task.js        # creates TaskRouter task + Airtable record
│       ├── accept-reservation.js # marks case wip in Airtable
│       ├── reject-reservation.js
│       ├── initialize-accepted-chat.js  # creates Conversation on chat accept
│       ├── voice-handler.js      # TwiML for phone callback bridge
│       ├── call-now-ivr.js       # TwiML IVR for Call Now channel
│       ├── call-now-wait.js      # hold message TwiML for Call Now queue
│       ├── resolve-case.js       # marks case resolved
│       ├── get-seller-cases.js   # seller polls for their cases
│       ├── get-case.js           # polls a single case (conversation_sid)
│       ├── get-associate-cases.js
│       ├── get-queue-count.js
│       └── ...
└── frontend/                     # React + Vite
    ├── .env                      # VITE_ prefixed vars
    └── src/
        ├── App.jsx               # SSO login + routing
        └── components/
            ├── AssociatePanel.jsx
            ├── SellerPanel.jsx
            ├── ChatWindow.jsx
            ├── AssociateChatPanel.jsx
            ├── EmailThreadView.jsx
            ├── PhoneControls.jsx
            └── ...
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
