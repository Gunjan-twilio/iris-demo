# inbound-parse-receiver

Express receiver for SendGrid Inbound Parse. Twilio Functions can't parse
`multipart/form-data`, so this app parses it, extracts the seller identity
(handles both direct emails and Exchange-forwarded emails where RFC From is
overwritten), and relays a clean JSON payload to the `inbound-parse-relay`
Twilio Function. Also handles SendGrid's "Post the raw, full MIME message" mode
via `mailparser`.

## Default: local Express + ngrok

```
npm install

TWILIO_FUNCTIONS_DOMAIN=iris-demo-2775-dev.twil.io \
RELAY_TOKEN=<same as functions/.env RELAY_TOKEN> \
PORT=3100 \
node index.js
```

In another terminal:

```
ngrok http 3100
```

Copy the `https://<hash>.ngrok.app` URL and:
1. SendGrid Console → Settings → Inbound Parse → destination URL: `https://<hash>.ngrok.app/inbound`
2. Set `FLY_INBOUND_DOMAIN=<hash>.ngrok.app` in `functions/.env` and redeploy functions (used by `simulate-forward-reply`)

Ngrok's free URLs churn on every restart — a paid ngrok reserved subdomain or Cloudflare Tunnel gives you a stable URL.

## Optional: fly.io deploy

Stable URL, survives your laptop sleeping.

```
fly launch --no-deploy
fly secrets set TWILIO_FUNCTIONS_DOMAIN=iris-demo-2775-dev.twil.io RELAY_TOKEN=<secret>
fly deploy
```

App URL: `https://<app-name>.fly.dev`. Same wiring — plug that URL into SendGrid Parse and `FLY_INBOUND_DOMAIN`.

## Optional shared secret

Set `SENDGRID_INBOUND_TOKEN` and add `?token=<value>` to the SendGrid Parse destination URL if you want an extra auth layer.
