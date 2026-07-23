// Demo helper. Constructs a synthetic Gmail-forwarded email payload matching
// SendGrid Inbound Parse's multipart shape and POSTs it to the fly.io
// receiver. Lets the seller trigger the exact production code path without
// needing real MX / Exchange forwarding.
exports.handler = async function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Access-Control-Allow-Origin', '*');
  response.appendHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.appendHeader('Content-Type', 'application/json');

  if (event.httpMethod === 'OPTIONS') {
    response.setStatusCode(200);
    return callback(null, response);
  }

  const { case_id, seller_email, seller_name, message, subject } = event;
  if (!case_id || !seller_email || !message) {
    response.setStatusCode(400);
    response.setBody({ error: 'case_id, seller_email, and message are required' });
    return callback(null, response);
  }

  if (!context.FLY_INBOUND_DOMAIN) {
    response.setStatusCode(500);
    response.setBody({ error: 'FLY_INBOUND_DOMAIN not configured' });
    return callback(null, response);
  }

  const emailSubject = subject && subject.includes(case_id) ? subject : `[${case_id}] ${subject || 'Re: your case'}`;
  const forwardedBody = buildForwardedBody({ seller_email, seller_name, message, case_id });

  const form = new FormData();
  form.append('from', `"Walmart Exchange" <exchange-forward@walmart.com>`);
  form.append('to', 'support@flex.walmart.com');
  form.append('subject', emailSubject);
  form.append('text', forwardedBody);
  form.append('headers', 'From: exchange-forward@walmart.com\nX-Forwarded-For: support@walmart.com\n');

  const url = `https://${context.FLY_INBOUND_DOMAIN}/inbound${context.SENDGRID_INBOUND_TOKEN ? `?token=${encodeURIComponent(context.SENDGRID_INBOUND_TOKEN)}` : ''}`;

  try {
    const res = await fetch(url, { method: 'POST', body: form });
    const text = await res.text();
    response.setStatusCode(res.ok ? 200 : 502);
    response.setBody({ ok: res.ok, status: res.status, detail: text });
    return callback(null, response);
  } catch (err) {
    console.error('[simulate-forward-reply]', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};

function buildForwardedBody({ seller_email, seller_name, message, case_id }) {
  const displayFrom = seller_name ? `"${seller_name}" <${seller_email}>` : seller_email;
  return `${message}

---------- Forwarded message ----------
From: ${displayFrom}
To: support@walmart.com
Subject: [${case_id}] Re: your case

${message}
`;
}
