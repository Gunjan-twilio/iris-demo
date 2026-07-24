const twilio = require('twilio');

// Called by the frontend before an associate's outbound send on an email_hybrid
// conversation. Snapshots to/cc email participants onto conversation attributes,
// then removes them so Twilio's built-in email dispatch can't fire when we post
// the message. Idempotent — safe to retry if already empty.
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
  if (!conversationSid) {
    response.setStatusCode(400);
    response.setBody({ error: 'conversationSid required' });
    return callback(null, response);
  }

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);

    const [participants, conversation] = await Promise.all([
      client.conversations.v1
        .services(context.CONVERSATIONS_SERVICE_SID)
        .conversations(conversationSid)
        .participants.list({ limit: 100 }),
      client.conversations.v1
        .services(context.CONVERSATIONS_SERVICE_SID)
        .conversations(conversationSid)
        .fetch(),
    ]);

    const toParts = participants.filter((p) => p.messagingBinding?.level === 'to');
    const ccParts = participants.filter((p) => p.messagingBinding?.level === 'cc');
    const toAddresses = toParts.map((p) => p.messagingBinding?.address).filter(Boolean).join(',');
    const ccAddresses = ccParts.map((p) => p.messagingBinding?.address).filter(Boolean).join(',');

    let priorAttrs = {};
    try { priorAttrs = JSON.parse(conversation.attributes || '{}'); } catch (_) {}
    const priorEmailMetadata = priorAttrs.emailMetadata || {};

    const emailMetadata = {
      ...priorEmailMetadata,
      to: toAddresses || priorEmailMetadata.to || '',
      cc: ccAddresses || priorEmailMetadata.cc || '',
    };

    await client.conversations.v1
      .services(context.CONVERSATIONS_SERVICE_SID)
      .conversations(conversationSid)
      .update({ attributes: JSON.stringify({ ...priorAttrs, emailMetadata }) });

    for (const p of [...toParts, ...ccParts]) {
      try {
        await client.conversations.v1
          .services(context.CONVERSATIONS_SERVICE_SID)
          .conversations(conversationSid)
          .participants(p.sid)
          .remove();
      } catch (err) {
        console.warn('[remove-email-participants] participant remove failed', p.sid, err.message);
      }
    }

    response.setBody({ ok: true, emailMetadata });
    return callback(null, response);
  } catch (err) {
    console.error('[remove-email-participants]', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
