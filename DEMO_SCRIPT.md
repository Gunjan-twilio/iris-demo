# IRIS Demo Script
**Estimated runtime: ~10 min** (2 min setup + 2 min each channel + 30 sec close)

---

## Pre-Demo Checklist

- [ ] Open two browser windows side by side
  - **Left — Seller portal:** https://iris-demo-2775-dev.twil.io/index.html#/seller
  - **Right — Associate CRM:** https://iris-demo-2775-dev.twil.io/index.html#/associate
- [ ] **Associate login (SSO):**
  - The CRM shows a login form — enter runtime domain: `busy-anteater-9071.twil.io`
  - Click **Login** → you'll be redirected to SSO → authenticate → redirected back to the CRM automatically
  - *(Runtime domain is saved in localStorage — you won't need to re-enter it on subsequent visits)*
- [ ] Set associate status to **Online** in the CRM
- [ ] Have Gmail open in a third tab (for email demo)
- [ ] Keep these tabs ready to pull up:
  - Flow diagram: https://iris-demo-2775-dev.twil.io/demo-flow-diagram.html
  - Email threading: https://iris-demo-2775-dev.twil.io/email-threading-explainer.html

---

## PART 1 — Setup & Architecture `2 min`

> "What you're looking at is a customer support platform for Walmart Marketplace sellers. On the left is the Seller portal — this is what Owl Shoes, a small footwear brand, would see when they need help. On the right is the Associate panel — this is the CRM a support associate works from."

> "The interesting part is what's underneath. This isn't the Twilio Flex hosted UI — we're using the Flex JavaScript SDK in headless mode. That means we get all of Twilio's routing engine — TaskRouter, Conversations, voice conferencing — but the interface is entirely our own React app."

**[ Pull up flow diagram ]**
https://iris-demo-2775-dev.twil.io/demo-flow-diagram.html

> "Here's how a request flows. Owl Shoes submits a support request — that hits the backend and creates a TaskRouter task. TaskRouter queues it with skill-based routing and sends it to the right worker. The associate's browser receives a `reservationCreated` event via the SDK — no polling, no page refresh. They accept, and the right channel spins up. Let me show you each one."

---

## PART 2 — Chat `2 min`

**Scenario:** Owl Shoes' listing for "Barn Owl Sneakers" was rejected with no explanation.

**[ Mark associate Online ]**

> "On the seller side, Owl Shoes opens a chat, describes the issue, and hits submit."

**[ Seller portal → Submit chat task ]**

Paste into the form:
```
Our listing for "Barn Owl Sneakers" was rejected with no explanation. Can you check why?
```
- Name: `Owl Shoes`
- Email: `Gunjan.i.gupta@gmail.com`

> "Immediately on the associate side, the request pops up as a real-time alert. The associate clicks Accept."

**[ Associate CRM → Click Accept ]**

> "The moment they accept, our backend calls `initialize-accepted-chat` — it creates a Twilio Conversation, adds both participants, and stamps the Conversation SID back onto the TaskRouter task. Both sides connect to that same Conversation using the Conversations SDK. The seller's chat window activates seamlessly — no loading lag."

**[ Send messages back and forth ]**

| Who | Message |
|-----|---------|
| 🛍️ Seller | `Hi, my listing for Barn Owl Sneakers was rejected today without any explanation. Can you check why?` |
| 🧑‍💻 Associate | `Hi Owl Shoes! Let me pull up that listing. Looks like it was flagged because the primary image background isn't pure white. If you swap that photo out it will auto-approve.` |
| 🛍️ Seller | `Oh wow, that's an easy fix. I'll re-upload it right now. Thank you!` |
| 🧑‍💻 Associate | `Happy to help! I'll close this out on my end. Have a great day!` |

> "No clunky hosted iframes, no generic chat widgets — just Twilio's core messaging engine surfaced natively inside a custom, branded interface."

---

## PART 3 — Phone `2 min`

**Scenario:** Owl Shoes hasn't received their February marketplace payout.

> "Owl Shoes submits a phone callback request — they enter their number and describe the payment issue."

**[ Seller portal → Submit phone task ]**

Paste into the form:
```
We haven't received our February marketplace payout.
```
- Phone: `+12342659468`

> "It instantly pops up on the associate's dashboard."

**[ Associate CRM → Click Accept ]**

> "The moment they accept, the backend automatically kicks off an outbound call. It connects to the associate's browser audio while simultaneously dialing the seller's phone number — bridging them into a live conversation instantly, zero manual dialing required."

**[ Show mute / hangup controls ]**

> "The associate has mute and hangup controls that persist even while navigating between cases — call state lives in a ref that survives React re-renders."

**[ Navigate to another tab and back — show controls stay visible ]**

> "Wrap up, hang up — task complete."

---

## PART 4 — Email `2 min`

**Scenario:** Owl Shoes received a chargeback on a bulk order and needs documentation guidance.

> "Email is the third channel. Owl Shoes submits a message about the chargeback dispute."

**[ Seller portal → Submit email task ]**

Paste into the form:
```
We received a $1,200 chargeback dispute on bulk order #99218. What specific documentation do we need to provide to fight this?
```

> "While that routes to the associate, let me show you how email threading works under the hood."

**[ Pull up email threading diagram ]**
https://iris-demo-2775-dev.twil.io/email-threading-explainer.html

> "Our backend makes a single call to the Flex Interactions API. Twilio handles everything else — it creates the Conversation, routes the task, and when the seller replies, it reads the `In-Reply-To` header from their mail client and appends the reply to the same Conversation automatically. No new task, no new routing event. The associate just sees the thread grow."

**[ Associate CRM → Click Accept ]**

> "The task lands in the case list just like chat or phone — the channel is abstracted from the associate's perspective. They see a case with context."

**[ Associate sends the chargeback template ]**

Paste the template response:
```
Hi Owl Shoes, to dispute a marketplace chargeback of this size, you will need to upload three documents: the signed delivery receipt, the original packing slip, and any message history with the buyer. I've attached the official template link right to your Seller dashboard.
```

**[ Show Gmail — seller receives the email ]**

**[ Seller replies in Gmail ]**

Paste the seller reply:
```
Perfect, we located the signed delivery receipt. We will compile the rest and submit through the portal link you provided. Thank you!
```

**[ Show the reply appear in the associate's thread — no new task ]**

---

## Closing `30 sec`

> "So the reason this model is compelling: you're not locked into the Flex hosted UI, but you're also not rebuilding routing, queuing, or worker presence from scratch. TaskRouter handles all of that. You write the experience you actually want — the SDK gives you the events to react to."

> "Every case, message, and task state reflects back into the IRIS database in real time, so any downstream system that needs that data already has it."

---

## Quick Reference

| Item | Value |
|------|-------|
| Seller portal | https://iris-demo-2775-dev.twil.io/index.html#/seller |
| Associate CRM | https://iris-demo-2775-dev.twil.io/index.html#/associate |
| Associate runtime domain | `busy-anteater-9071.twil.io` |
| Flow diagram | https://iris-demo-2775-dev.twil.io/demo-flow-diagram.html |
| Email threading | https://iris-demo-2775-dev.twil.io/email-threading-explainer.html |
| Seller name | `Owl Shoes` |
| Seller email | `Gunjan.i.gupta@gmail.com` |
| Seller phone | `+12342659468` |
