# IRIS Walmart Demo — Developer Setup Guide

---

## Prerequisites

- Node.js 22 (matches Twilio Serverless runtime)
- Twilio CLI installed (`npm install -g twilio-cli`)
- Twilio Serverless plugin (`twilio plugins:install @twilio-labs/plugin-serverless`)
- A Twilio account with **Flex enabled** (required for TaskRouter + Conversations Service)
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

## Step 2: Configure the Flex TaskRouter Workspace

Flex automatically provisions a TaskRouter workspace when your account is set up. Do not create a new one — use the existing Flex workspace.

1. Console → Flex → Manage → TaskRouter (or Console → TaskRouter → Workspaces)
2. You will see a workspace named something like `Flex Task Assignment` — open it
3. Note down `WORKSPACE_SID` (starts with `WS`)

**Create two Activities** (if not already present — Flex pre-creates some):

Go to your workspace → Activities → Create Activity:

| Name       | Availability |
| ---------- | ------------ |
| `Reserved` | Unavailable  |
| `Busy`     | Unavailable  |

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

Alternatively, you can paste the workflow configuration directly as JSON via Console → TaskRouter → Workspace → Workflows → Create Workflow → (JSON editor). Replace queue SIDs with your own:

```json
{
  "task_routing": {
    "filters": [
      {
        "filter_friendly_name": "Payments",
        "expression": "category == \"payments\"",
        "targets": [
          {
            "queue": "WQxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            "known_worker_friendly_name": "task.worker_friendly_name",
            "timeout": 30
          },
          {
            "queue": "WQxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            "expression": "worker.routing.levels.payments >= 4",
            "timeout": 30
          },
          {
            "queue": "WQxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            "expression": "worker.routing.levels.payments > 0",
            "timeout": 30
          },
          {
            "queue": "WQxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          }
        ]
      },
      {
        "filter_friendly_name": "Listings",
        "expression": "category == \"listings\"",
        "targets": [
          {
            "queue": "WQxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            "expression": "(skills HAS 'listings') AND (languages HAS 'english')",
            "timeout": 15
          },
          {
            "queue": "WQxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          }
        ]
      },
      {
        "filter_friendly_name": "Everything Else",
        "expression": "1==1",
        "targets": [
          {
            "queue": "WQxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          }
        ]
      }
    ],
    "default_filter": {
      "queue": "WQxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    }
  }
}
```

**Worker setup (SSO path):**

This demo uses **Flex SSO** — the worker is automatically provisioned by Auth0 (or your iDP) on first login. You do not need to create a worker manually.

After the associate logs in for the first time:

1. Console → TaskRouter → Workspace → Workers — you will see the SSO worker appear
2. Update its attributes to include routing skills:

```json
{ "routing": { "skills": ["payments", "listings"], "levels": {} } }
```

> The attributes must use the nested `routing.skills` structure to match the queue expression `routing.skills HAS "payments"`. A flat `{"skills": [...]}` will not match.
> The worker's `contact_uri` is set automatically by Flex SSO based on the Auth0 identity — do not set it manually.

---

## Step 3: Find the Flex Conversation Service SID

> **Important:** This demo uses the **Flex Conversation Service** (created automatically when Flex is provisioned). Do NOT create a new custom Conversations service — using the wrong `IS...` SID will break chat.

1. Console → Flex → Manage → Messaging → **Conversation Service SID**
2. Copy the `IS...` SID and use it as `CONVERSATIONS_SERVICE_SID`

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

> **Note:** Airtable is used here for simplicity and ease of setup in this demo. In a production implementation this should be replaced with your own system of record (CRM, database, etc.).

1. Create a new Airtable base called `IRIS-Demo`
2. Create three tables:

**Table: `Cases`**

| Field Name         | Type                                                               |
| ------------------ | ------------------------------------------------------------------ |
| `case_id`          | Single line text                                                   |
| `seller_name`      | Single line text                                                   |
| `seller_email`     | Single line text                                                   |
| `seller_phone`     | Single line text                                                   |
| `help_category`    | Single select (options: `payments`, `listings`)                    |
| `channel`          | Single select (options: `chat`, `phone`, `email`, `call_now`)      |
| `status`           | Single select (options: `new`, `wip`, `needs_info`, `resolved`)    |
| `case_summary`     | Single line text                                                   |
| `task_sid`         | Single line text                                                   |
| `reservation_sid`  | Single line text                                                   |
| `conversation_sid` | Single line text                                                   |
| `assigned_worker`  | Single line text                                                   |
| `created_at`       | Date                                                               |
| `updated_at`       | Date and time                                                      |

**Table: `EmailMessages`**

| Field Name  | Type            |
| ----------- | --------------- |
| `case_id`   | Single line text |
| `direction` | Single line text (`inbound` / `outbound`) |
| `author`    | Single line text |
| `body`      | Long text        |

**Table: `Templates`**

| Field Name     | Type            |
| -------------- | --------------- |
| `name`         | Single line text |
| `description`  | Single line text |
| `html_content` | Long text        |

3. Note down:
   - `AIRTABLE_API_KEY` (from Account → API)
   - `AIRTABLE_BASE_ID` (from the URL: `airtable.com/{BASE_ID}/...`)

---

## Step 7: Configure environment

Copy the example file and fill in all values:

```bash
cp .env.example .env
# edit .env with your values from the steps above
cp .env functions/.env
```

You will also need a `frontend/.env` for the Vite app:

```bash
cp frontend/.env.example frontend/.env
# edit frontend/.env with your values
```

```
VITE_FUNCTIONS_BASE_URL=https://<your-serverless-domain>.twil.io
VITE_TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
```

The `VITE_FUNCTIONS_BASE_URL` is the deployed Serverless domain — you won't have it until Step 8. You can set it after first deploy.

---

## Step 8: Install dependencies and deploy

```bash
npm install              # installs dotenv-cli used by the deploy script
cd frontend && npm install && cd ..
npm run deploy
```

`npm run deploy` builds the frontend, then runs `twilio serverless:deploy` with credentials injected from the root `.env` via `dotenv-cli` — no Twilio CLI profile needed. Your Serverless domain will be printed at the end — copy it.

---

## Step 9: Post-deploy configuration

After first deploy:

1. **TwiML App voice URL** — update your TwiML App's Voice Request URL to:

   ```
   https://<your-domain>.twil.io/voice-handler
   ```

2. **TaskRouter assignment callback** — Console → TaskRouter → Workspace → Settings → set Assignment Callback URL to:

   ```
   https://<your-domain>.twil.io/assignment-callback
   ```

   This stamps `task_sid` and `reservation_sid` onto Airtable cases so the associate panel can look up pending reservations.

3. **Frontend env** — set `VITE_FUNCTIONS_BASE_URL` in `frontend/.env` to the domain above, then redeploy:

   ```bash
   npm run deploy
   ```

4. **Airtable `channel` field** — add these valid values to the single-select (or allow free text):
   `chat`, `phone`, `email`, `call_now`

5. **TaskRouter activities** — the associate status menu is driven live from TaskRouter. You can add custom activities (Lunch, Training, etc.) via Console → TaskRouter → Workspace → Activities.

---

## Additional resources

**Flex SDK sample repo:** https://github.com/twilio-samples/flex-sdk-demo/

Review this for additional sample code and reference implementations covering the headless Flex SDK patterns used in this project.

**AI-assisted development:** When using Claude, Copilot, or similar agents to extend this codebase, pointing the agent at the above repo as a reference is strongly recommended. The Flex SDK has non-obvious behaviors around token grants, reservation handling, and channel-specific accept flows — the sample repo demonstrates the correct patterns and helps agents avoid common pitfalls.

---

## Channels supported

| Channel      | How it works                                                                                                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **chat**     | `create-webchat-interaction` creates a Flex Interactions API session via Studio Flow; seller enters chat immediately, associate receives a reservation via `reservationCreated`                                       |
| **phone**    | Associate accepts, `StartOutboundCall` dials seller's number, bridges via Voice conference                                                                                                                            |
| **email**    | Uses Flex Interactions API (`type: email`); replies from inbox or portal append to the same thread                                                                                                                    |
| **call_now** | `create-task` dials seller immediately → IVR → press 1 → `<Enqueue>` into TaskRouter → hold music → associate accepts via `reservation.dequeue()` which bridges the live call to the associate's browser Voice Device |
