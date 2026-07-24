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
   `chat`, `phone`, `email`, `email_hybrid`, `email_forwarded`, `call_now`

5. **TaskRouter activities** — the associate status menu is driven live from TaskRouter. You can add custom activities (Lunch, Training, etc.) via Console → TaskRouter → Workspace → Activities.

---

## Step 10: Enable the extra email channels (optional)

The base setup gives you OOTB `email`. The two extra variants (`email_hybrid`, `email_forwarded`) demo the trade-offs between Twilio-managed and self-managed email — enable one or both depending on what you want to show.

### 10a. Common prerequisites (both variants)

You need a domain you own (not Walmart's for the demo — use your own throughout). Assume `yourdomain.com` below.

1. **SendGrid account** with an API key that has Mail Send scope. Add to `functions/.env`:

   ```
   SENDGRID_API_KEY=SG.xxx
   FROM_EMAIL=support@yourdomain.com
   FROM_DISPLAY_NAME=Walmart Support
   ```

2. **SendGrid Domain Authentication** on `yourdomain.com`. Adds 3 CNAMEs to your DNS (grey-cloud / DNS-only in Cloudflare). Verify in SendGrid Console → Settings → Sender Authentication. Send a test email via the SendGrid API to confirm the domain-authed From delivers to your inbox before proceeding.

3. **Airtable `channel` field** — ensure `email_hybrid` and `email_forwarded` are in the allowed values (step 4 above).

### 10b. `email_hybrid` — Twilio-managed inbound + custom outbound

The Twilio Flex Email address for this channel anchors the projected_address that routes seller replies back into Twilio.

1. **Authenticate a subdomain in Flex Email.** Console → Flex → Channel Management → Email → Authenticate domain. Use a dedicated subdomain (e.g., `parse.yourdomain.com`) — do NOT use the root, since the root's MX likely serves other mail (e.g., ImprovMX forwarding, see below). Add the CNAMEs + the MX record Twilio lists to your DNS, then verify.

2. **Create a Flex email address** on that subdomain. Recommended: `catchall@parse.yourdomain.com` with Studio Flow integration = `Email Flow` (Twilio's default) and Integration name = `Email Hybrid`.

3. **Set the env var** so the `email_hybrid` create-task branch uses that address as its Interactions API `from` (which anchors projected_address routing):

   ```
   EMAIL_HYBRID_ADDRESS=catchall@parse.yourdomain.com
   ```

4. **Set up branded reply forwarding** (optional but recommended for the demo). Sign up for [ImprovMX](https://improvmx.com) (free), add `yourdomain.com`, add its MX records to your DNS, and create a forwarding rule:

   ```
   support@yourdomain.com  →  catchall@parse.yourdomain.com
   ```

   This lets the seller see a fully branded `Reply-To: support@yourdomain.com`, with ImprovMX transparently forwarding replies to Twilio's Flex Email ingress.

5. **TEMPORARY In-Reply-To interceptor** — Twilio Flex Email does not currently route inbound replies by RFC `In-Reply-To` / `References`; it only matches on the recipient projected_address. Since branded replies arrive at `catchall@parse.yourdomain.com` (the base Flex address, not the per-conversation projected_address), each reply spawns a new "ghost" conversation. To route replies back into the original conversation, this repo ships a Studio Flow interceptor:

   - `functions/functions/intercept-reply.js` — Studio Flow Run Function target. Reads the ghost's In-Reply-To from ChannelMetadata, looks it up in a Twilio Sync Map (`email_message_map`), copies the message into the original conversation, closes the ghost. Returns `{matched: true}` so the flow ends before Send-to-Flex creates a task.
   - `functions/functions/send-hybrid-email.js` — writes the outbound Message-Id → source conversationSid to Sync on every successful send.
   - Wire the widgets into your `Email Flow` Studio Flow by running `python3 scripts/apply-temp-intercept.py` (or apply manually — Run Function widget calling `/intercept-reply` between the Trigger's `incomingConversationMessage` and Send-to-Flex, plus a Split Based On checking `{{widgets.InterceptReply.parsed.matched}} == true` → End on match, → Send-to-Flex on no match).

   ```
   SYNC_SERVICE_SID=default
   ```

   **Remove this once Twilio adds native In-Reply-To routing.** Everything is tagged `TEMP FIX` — `grep -rn "TEMP FIX" functions/` finds all the spots. `scripts/revert-temp-intercept.py` reverts the Studio Flow and deletes the Sync Map when you're ready.

### 10c. `email_forwarded` — fully self-managed email plane

Runs entirely on your infrastructure — SendGrid Inbound Parse for reception, an external Express receiver to translate multipart into clean JSON, and SendGrid Mail Send for outbound. Choose this when the customer cannot cede any DNS/MX to Twilio.

1. **SendGrid Inbound Parse.** Console → SendGrid → Settings → Inbound Parse → Add Host & URL:

   - Host: `parse.yourdomain.com` (the same subdomain as `email_hybrid` — SendGrid Parse and Twilio Flex Email use the same MX, `mx.sendgrid.net`, so both can coexist provided the destination URL is set correctly here).
   - Destination URL: the public URL of your external receiver (see next step).

2. **External receiver.** Twilio Runtime can't parse `multipart/form-data`, so this runs off-Twilio. See `inbound-parse-receiver/README.md` — default path is local Express (`node index.js`) + ngrok, optional fly.io deploy included.

   Env vars for the receiver (in `inbound-parse-receiver/.env`):

   ```
   TWILIO_FUNCTIONS_DOMAIN=<your-serverless-domain>.twil.io
   RELAY_TOKEN=<same-value-as-functions/.env>
   ```

   And in `functions/.env`:

   ```
   RELAY_TOKEN=<same random string>
   FLY_INBOUND_DOMAIN=<ngrok subdomain or fly app URL>
   SENDGRID_INBOUND_TOKEN=  # optional shared secret via ?token= on the Parse URL
   ```

3. **`FROM_EMAIL`** in `functions/.env` — same as step 10a; used by `outbound-email-forwarded.js` to dispatch via SendGrid Mail Send with your branded From. This channel doesn't need forwarding infra because the seller's replies come directly to the SendGrid Parse subdomain and flow through the custom pipeline; no ImprovMX hop needed unless you want a branded root address that forwards.

4. **Programmatic scoped webhook** — `create-task.js` for `email_forwarded` attaches an `onMessageAdded` webhook to each new conversation pointing at `/outbound-email-forwarded`. No manual console step required.

---

## Additional resources

**Flex SDK sample repo:** https://github.com/twilio-samples/flex-sdk-demo/

Review this for additional sample code and reference implementations covering the headless Flex SDK patterns used in this project.

**AI-assisted development:** When using Claude, Copilot, or similar agents to extend this codebase, pointing the agent at the above repo as a reference is strongly recommended. The Flex SDK has non-obvious behaviors around token grants, reservation handling, and channel-specific accept flows — the sample repo demonstrates the correct patterns and helps agents avoid common pitfalls.

---

## Channels supported

| Channel               | How it works                                                                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **chat**              | `create-webchat-interaction` creates a Flex Interactions API session via Studio Flow; seller enters chat immediately, associate receives a reservation via `reservationCreated`                                       |
| **phone**             | Associate accepts, `StartOutboundCall` dials seller's number, bridges via Voice conference                                                                                                                            |
| **call_now**          | `create-task` dials seller immediately → IVR → press 1 → `<Enqueue>` into TaskRouter → hold music → associate accepts via `reservation.dequeue()` which bridges the live call to the associate's browser Voice Device |
| **email**             | OOTB pure Flex — Flex Interactions API (`type: email`) owns both inbound (Twilio-managed projected_address MX) and outbound (Twilio's SendGrid). Replies to the projected_address auto-append to the same conversation. |
| **email_hybrid**      | OOTB Flex Interactions inbound (as above) + client-side "participants dance" that intercepts outbound send and dispatches via **your own** SendGrid with a branded `From`. Preserves Twilio's threading/ChannelMetadata while letting the seller see your branded address. Inbound reply routing currently uses a TEMP In-Reply-To interceptor (`intercept-reply.js` + Twilio Sync Map + Studio Flow Run Function widget) — removed once Twilio ships native In-Reply-To routing. |
| **email_forwarded**   | Fully custom email plane. Seller replies to `support@yourdomain` → forwarding (e.g., ImprovMX) → SendGrid Inbound Parse on a subdomain → external Express receiver (`inbound-parse-receiver/`) parses multipart + mailparser MIME → posts slim JSON to `inbound-parse-relay.js` → appends message to a plain Conversation. Outbound goes via SendGrid Mail Send with our own RFC threading headers (Message-Id, In-Reply-To, References, X-Iris-Case-ID). Chosen when the customer cannot cede DNS/MX to Twilio.  |
