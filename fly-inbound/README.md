# iris-inbound-parse

Express receiver for SendGrid Inbound Parse. Twilio Functions can't parse
`multipart/form-data`, so this app parses it, extracts the forwarded seller
identity (Exchange strips RFC From/To), and relays a clean JSON payload to
the `inbound-parse-relay` Twilio Function.

## Local

```
cp .env.example .env
# edit .env
npm install
npm run dev
```

Then expose with ngrok while iterating:

```
ngrok http 3000
```

Point SendGrid Inbound Parse (or `simulate-forward-reply` `FLY_INBOUND_DOMAIN`)
at the ngrok URL.

## Deploy to fly.io

```
fly launch --no-deploy   # accept defaults; keeps this fly.toml/Dockerfile
fly secrets set TWILIO_FUNCTIONS_DOMAIN=iris-demo-2775-dev.twil.io RELAY_TOKEN=<secret>
fly deploy
```

App URL: `https://iris-inbound-parse.fly.dev`

Set `SENDGRID_INBOUND_TOKEN` and add `?token=<value>` to the SendGrid Parse
destination URL if you want an extra auth layer.
