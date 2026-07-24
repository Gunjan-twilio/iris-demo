const twilio = require('twilio');

// Post-event onMessageAdded webhook, attached per-conversation from create-task.js
// email_hybrid branch. Snapshots current to/cc participant addresses and the
// message's ChannelMetadata (Twilio-tracked RFC threading headers) onto
// conversation.attributes.emailMetadata so subsequent outbound sends can
// reconstruct the participants (after the "dance" removal) and thread correctly.
exports.handler = async function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'application/json');

  try {
    const conversationSid = event.ConversationSid;
    if (!conversationSid) {
      response.setBody({ skipped: 'no_conversation_sid' });
      return callback(null, response);
    }

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

    const to = participants.filter((p) => p.messagingBinding?.level === 'to');
    const cc = participants.filter((p) => p.messagingBinding?.level === 'cc');
    const toAddresses = to.map((p) => p.messagingBinding?.address).filter(Boolean).join(',');
    const ccAddresses = cc.map((p) => p.messagingBinding?.address).filter(Boolean).join(',');

    let priorAttrs = {};
    try { priorAttrs = JSON.parse(conversation.attributes || '{}'); } catch (_) {}

    const priorEmailMetadata = priorAttrs.emailMetadata || {};
    const emailMetadata = {
      ...priorEmailMetadata,
      to: toAddresses || priorEmailMetadata.to || '',
      cc: ccAddresses || priorEmailMetadata.cc || '',
      from: event.From || priorEmailMetadata.from || '',
      channelMetadata: event.ChannelMetadata || priorEmailMetadata.channelMetadata,
    };

    const updatedAttrs = { ...priorAttrs, emailMetadata };

    await client.conversations.v1
      .services(context.CONVERSATIONS_SERVICE_SID)
      .conversations(conversationSid)
      .update({ attributes: JSON.stringify(updatedAttrs) });

    response.setBody({ ok: true, emailMetadata });
    return callback(null, response);
  } catch (err) {
    console.error('[persist-email-participants]', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
