const twilio = require('twilio');

// Called by the frontend as the middle step of the email_hybrid outbound dance:
// participants have already been removed, and the outbound message has been
// posted to the Conversation (so Twilio populated ChannelMetadata with RFC
// threading headers). This function reads that ChannelMetadata plus the
// to/cc snapshot from conversation.attributes.emailMetadata, and dispatches
// the actual email via SendGrid API.
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

  const conversationSid = event.conversationSid || event.ConversationSid;
  const messageSid = event.messageSid || event.MessageSid;
  const subject = event.subject || '';
  const htmlBody = event.htmlBody || '';
  const plainBody = event.plainBody || (htmlBody ? htmlBody.replace(/<[^>]+>/g, '').trim() : '');

  if (!conversationSid || !messageSid || (!htmlBody && !plainBody)) {
    response.setStatusCode(400);
    response.setBody({ error: 'conversationSid, messageSid, and body are required' });
    return callback(null, response);
  }

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);

    const [conversation, messageChannelMetadata] = await Promise.all([
      client.conversations.v1
        .services(context.CONVERSATIONS_SERVICE_SID)
        .conversations(conversationSid)
        .fetch(),
      fetchChannelMetadata(context, conversationSid, messageSid).catch((err) => {
        console.warn('[send-hybrid-email] ChannelMetadata fetch failed', err.message);
        return null;
      }),
    ]);

    let attrs = {};
    try { attrs = JSON.parse(conversation.attributes || '{}'); } catch (_) {}
    const emailMetadata = attrs.emailMetadata || {};
    const caseId = attrs.case_id || attrs.caseId || '';

    const toAddresses = (emailMetadata.to || '').split(',').map((s) => s.trim()).filter(Boolean);
    const ccAddresses = (emailMetadata.cc || '').split(',').map((s) => s.trim()).filter(Boolean);

    if (toAddresses.length === 0) {
      response.setStatusCode(409);
      response.setBody({ error: 'no_to_addresses', hint: 'run remove-email-participants first' });
      return callback(null, response);
    }

    const headers = {
      'X-Iris-Case-ID': caseId,
      'X-Iris-Conversation-SID': conversationSid,
      'X-Iris-Message-SID': messageSid,
    };

    // ChannelMetadata for email conversations exposes RFC 5322 threading fields.
    // Field names vary in Twilio's response — try both nested and flat shapes.
    const cm = messageChannelMetadata?.data || messageChannelMetadata || {};
    if (cm.message_id || cm.MessageId || cm['Message-Id']) {
      headers['Message-Id'] = cm.message_id || cm.MessageId || cm['Message-Id'];
    }
    if (cm.in_reply_to || cm.InReplyTo || cm['In-Reply-To']) {
      headers['In-Reply-To'] = cm.in_reply_to || cm.InReplyTo || cm['In-Reply-To'];
    }
    if (cm.references || cm.References) {
      const refs = cm.references || cm.References;
      headers['References'] = Array.isArray(refs) ? refs.join(' ') : refs;
    }

    const html = htmlBody || `<p>${escapeHtml(plainBody).replace(/\n/g, '<br>')}</p>`;

    const personalization = { to: toAddresses.map((email) => ({ email })), subject };
    if (ccAddresses.length) personalization.cc = ccAddresses.map((email) => ({ email }));

    const sgRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${context.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [personalization],
        from: {
          email: context.FROM_EMAIL,
          name: context.FROM_DISPLAY_NAME || 'Walmart Support',
        },
        reply_to: { email: context.FROM_EMAIL },
        headers,
        content: [
          { type: 'text/plain', value: plainBody },
          { type: 'text/html', value: html },
        ],
      }),
    });

    if (!sgRes.ok) {
      const errText = await sgRes.text();
      console.error('[send-hybrid-email] SendGrid failure', sgRes.status, errText);
      response.setStatusCode(502);
      response.setBody({ error: 'sendgrid_failed', status: sgRes.status, detail: errText, headers });
      return callback(null, response);
    }

    response.setBody({ ok: true, to: toAddresses, cc: ccAddresses, subject, headers });
    return callback(null, response);
  } catch (err) {
    console.error('[send-hybrid-email]', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};

async function fetchChannelMetadata(context, conversationSid, messageSid) {
  const auth = Buffer.from(`${context.ACCOUNT_SID}:${context.AUTH_TOKEN}`).toString('base64');
  const res = await fetch(
    `https://conversations.twilio.com/v1/Services/${context.CONVERSATIONS_SERVICE_SID}/Conversations/${conversationSid}/Messages/${messageSid}/ChannelMetadata`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  if (!res.ok) throw new Error(`ChannelMetadata ${res.status}`);
  return await res.json();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
