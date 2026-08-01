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

    // Fetch conversation attrs + recent messages in parallel. We need the
    // LAST INBOUND message's ChannelMetadata (its RFC Message-Id + References)
    // so our outbound can chain In-Reply-To / References properly — Gmail
    // forgives a missing chain via subject-matching, Yahoo does not.
    const [conversation, recentMessages] = await Promise.all([
      client.conversations.v1
        .services(context.CONVERSATIONS_SERVICE_SID)
        .conversations(conversationSid)
        .fetch(),
      client.conversations.v1
        .services(context.CONVERSATIONS_SERVICE_SID)
        .conversations(conversationSid)
        .messages.list({ order: 'desc', limit: 20 }),
    ]);

    // Inbound messages are authored by an email address; outbound (associate)
    // are authored by an auth0 identity. Pick the most recent inbound.
    const lastInbound = recentMessages.find(
      (m) => typeof m.author === 'string' && m.author.includes('@')
    );
    const inboundChannelMetadata = lastInbound
      ? await fetchChannelMetadata(context, conversationSid, lastInbound.sid).catch((err) => {
          console.warn('[send-hybrid-email] inbound ChannelMetadata fetch failed', err.message);
          return null;
        })
      : null;

    let attrs = {};
    try { attrs = JSON.parse(conversation.attributes || '{}'); } catch (_) {}
    const emailMetadata = attrs.emailMetadata || {};
    // Prefer caseId from the frontend (which has the task attributes);
    // fall back to whatever's on the conversation.
    const caseId = event.caseId || event.CaseId || attrs.case_id || attrs.caseId || '';

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

    // Case-ID-embedded Message-Id. The conversation gets closed on send, so
    // seller replies always land on a NEW conversation. route-inbound-reply
    // parses the case ID out of the reply's In-Reply-To header (from
    // ChannelMetadata) to link the new task back to the original case.
    // Domain is derived from FROM_EMAIL so it always matches our sending domain.
    const fromDomain = (context.FROM_EMAIL || '').split('@')[1] || 'twilio.com';
    if (caseId) {
      headers['Message-Id'] = `<case-${caseId}-${messageSid}@${fromDomain}>`;
    } else {
      headers['Message-Id'] = `<${context.CONVERSATIONS_SERVICE_SID}.${conversationSid}.${messageSid}@twilio.com>`;
    }

    // Chain the RFC thread: our In-Reply-To points at the seller's most recent
    // inbound Message-Id, References accumulates the prior chain + that ID.
    // Without this, Yahoo treats each outbound as an unrelated email.
    const cm = inboundChannelMetadata?.data || inboundChannelMetadata || {};
    const inboundMessageId = cm.message_id || cm.MessageId || cm['Message-Id'];
    if (inboundMessageId) {
      headers['In-Reply-To'] = inboundMessageId;
      const priorRefs = cm.references || cm.References || '';
      const refsList = Array.isArray(priorRefs)
        ? priorRefs
        : (priorRefs ? String(priorRefs).split(/\s+/).filter(Boolean) : []);
      headers['References'] = [...refsList, inboundMessageId].join(' ');
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
        // Reply-To stays branded. Twilio Flex matches inbound replies back to
        // this conversation via RFC In-Reply-To / References headers, which we
        // spread from ChannelMetadata just above. The seller sees support@... .
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
