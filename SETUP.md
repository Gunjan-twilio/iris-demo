# IRIS Walmart Demo — Developer Setup Guide

---

## Prerequisites

- Node.js 18+
- Twilio CLI installed (`npm install -g twilio-cli`)
- Twilio Serverless plugin (`twilio plugins:install @twilio-labs/plugin-serverless`)
- A Twilio account (trial is fine — share the Account SID with Gunjan for credits)
- An Airtable account

---

## Step 1: Twilio Account Setup

1. Go to [console.twilio.com](https://console.twilio.com) and create a new account
2. Note down:
   - `ACCOUNT_SID` (starts with `AC`)
   - `AUTH_TOKEN`
3. Buy a phone number with Voice capability (needed for phone channel)
   - Console → Phone Numbers → Buy a Number → filter by Voice

---

## Step 2: Create a TaskRouter Workspace

1. Console → Explore Products → TaskRouter → Workspaces → Create Workspace
2. Name it `IRIS-Demo`
3. Note down `WORKSPACE_SID` (starts with `WS`)

**Before creating queues — create two Activities:**

Go to your workspace → Activities → Create Activity:

| Name | Availability |
|---|---|
| `Reserved` | Unavailable |
| `Busy` | Unavailable |

These must exist before you can configure the queues below.

**Create two Task Queues inside the workspace:**

For each queue:
- **Reservation Activity** → `Reserved`
- **Assignment Activity** → `Busy`
- **Max Reserved Workers** → `1`

Queue 1:
- Name: `payments-queue`
- Target Workers Expression: `routing.skills HAS "payments"`

Queue 2:
- Name: `listings-queue`
- Target Workers Expression: `routing.skills HAS "listings"`

**Create one Workflow:**

1. Workspace → Workflows → Create Workflow
2. Name: `iris-routing`
3. Under **Routing Steps**, add two steps:

Step 1 — Payments:
- Filter expression: `task.skill == "payments"`
- Queue: `payments-queue`
- Leave **Known Workers** blank

Step 2 — Listings:
- Filter expression: `task.skill == "listings"`
- Queue: `listings-queue`
- Leave **Known Workers** blank

4. Note down `WORKFLOW_SID` (starts with `WW`)

> The workflow evaluates steps top to bottom and sends the task to the first queue whose filter matches. The `task.skill` value is set by your backend when a seller submits a case.

**Create one Worker (simulates an associate):**

1. Workspace → Workers → Create Worker
2. Fill in:

| Field | Value |
|---|---|
| Name | `Associate-1` |
| Activity | `Offline` |
| Attributes | `{"routing": {"skills": ["payments", "listings"]}, "contact_uri": "client:associate1"}` |

3. Note down `WORKER_SID` (starts with `WK`)

> The attributes must use the nested `routing.skills` structure to match the queue expression `routing.skills HAS "payments"`. A flat `{"skills": [...]}` will not match.
> Activity is set to `Offline` by default — the associate will go `Available` from the IRIS UI when the demo runs.

---

## Step 3: Create a Conversations Service

1. Console → **Conversations Classic** → Services → Create Service

> Despite the "Classic" label, this is the correct product for live chat in this demo. Twilio reorganized the console around newer AI products (Conversation Intelligence, Conversation Orchestrator) and renamed the standard Conversations API to "Conversations Classic". The SID starting with `IS` is what you need.

2. Name it `iris-conversations`
3. Note down `CONVERSATIONS_SERVICE_SID` (starts with `IS`)

---

## Step 4: Create a TwiML App (for Voice)

1. Console → Voice → TwiML Apps → Create
2. Name: `IRIS-Voice`
3. Voice Request URL: leave blank for now (fill after deploying functions)
4. Note down `TWIML_APP_SID` (starts with `AP`)

---

## Step 5: Create an API Key

1. Console → Account → API Keys → Create API Key
2. Type: Standard
3. Note down `API_KEY_SID` (starts with `SK`) and `API_KEY_SECRET`
4. Used to generate access tokens for the browser SDKs

---

## Step 6: Airtable Setup

1. Create a new Airtable base called `IRIS-Demo`
2. Create one table called `Cases` with these fields:

| Field Name | Type |
|---|---|
| `case_id` | Single line text |
| `seller_name` | Single line text |
| `help_category` | Single line text (options: `payments`, `listings`) |
| `channel` | Single line text (options: `chat`, `phone`) |
| `status` | Single line text (options: `new`, `wip`, `needs_info`, `resolved`) |
| `task_sid` | Single line text |
| `conversation_sid` | Single line text |
| `assigned_worker` | Single line text |
| `created_at` | Date |

3. Note down:
   - `AIRTABLE_API_KEY` (from Account → API)
   - `AIRTABLE_BASE_ID` (from the URL: `airtable.com/{BASE_ID}/...`)

---

## Step 7: Initialize the Twilio Functions Project

```bash
cd ~/Desktop/workspace/iris-walmart-demo
twilio serverless:init functions --empty
cd functions
```

Create a `.env` file inside `functions/`:

```
ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AUTH_TOKEN=your_auth_token
API_KEY_SID=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
API_KEY_SECRET=your_api_key_secret
WORKSPACE_SID=WSxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
WORKFLOW_SID=WWxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
CONVERSATIONS_SERVICE_SID=ISxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWIML_APP_SID=APxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
AIRTABLE_API_KEY=your_airtable_key
AIRTABLE_BASE_ID=appxxxxxxxxxxxxxxx
```

---

## Step 8: Initialize the React Frontend

```bash
cd ~/Desktop/workspace/iris-walmart-demo
npm create vite@latest frontend -- --template react
cd frontend
npm install
npm install @twilio/conversations twilio-client airtable
```

---

## Step 9: Local Development

Run functions locally:
```bash
cd functions
twilio serverless:start
# Runs on http://localhost:3000
```

Run frontend locally:
```bash
cd frontend
npm run dev
# Runs on http://localhost:5173
```

Use ngrok or Twilio CLI's built-in tunnel to expose local functions for TaskRouter webhooks during development.

---

## Step 10: Deploy Functions

```bash
cd functions
twilio serverless:deploy
```

After deploy, you'll get a base URL like `https://iris-walmart-demo-xxxx.twil.io`. Then:

1. Go back to your TwiML App → update Voice Request URL to `https://iris-walmart-demo-xxxx.twil.io/voice-handler`
2. Go to TaskRouter Workspace → Event Callbacks → set to `https://iris-walmart-demo-xxxx.twil.io/task-event`

---

## What Gets Built Next

Once all of the above is in place, the following files will be generated:

| File | Purpose |
|---|---|
| `functions/create-task.js` | Seller submits a case → creates TaskRouter task + Airtable record |
| `functions/accept-reservation.js` | Associate accepts a task |
| `functions/reject-reservation.js` | Associate rejects a task |
| `functions/token.js` | Issues access tokens for browser Voice + Chat SDKs |
| `functions/voice-handler.js` | TwiML for outbound callback to seller |
| `functions/task-event.js` | Webhook that receives TaskRouter events |
| `frontend/SellerPanel.jsx` | Seller submits case, joins chat |
| `frontend/AssociatePanel.jsx` | IRIS view — incoming task, accept/reject, chat/phone UI |
