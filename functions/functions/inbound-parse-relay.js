const twilio = require('twilio');
const Airtable = require('airtable');

// Receives clean JSON from the fly.io inbound-parse receiver. Looks up the
// open email_forwarded case in Airtable and appends the seller's message to
// its Conversation. The associate's EmailForwardedThreadView picks it up
// live via the Conversations SDK subscription.
exports.handler = async function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'application/json');

  if (context.RELAY_TOKEN && event.request?.headers?.['x-relay-token'] !== context.RELAY_TOKEN) {
    response.setStatusCode(401);
    response.setBody({ error: 'unauthorized' });
    return callback(null, response);
  }

  const { case_id, seller_email, subject, message, message_id, in_reply_to, references } = event;
  if (!case_id || !seller_email || !message) {
    response.setStatusCode(400);
    response.setBody({ error: 'case_id, seller_email, and message are required' });
    return callback(null, response);
  }
  const referencesArr = Array.isArray(references)
    ? references
    : (typeof references === 'string' && references
        ? references.split(/[\s,]+/).filter(Boolean)
        : []);

  const normalizedEmail = seller_email.toLowerCase().trim();

  try {
    const base = new Airtable({ apiKey: context.AIRTABLE_API_KEY }).base(context.AIRTABLE_BASE_ID);
    const records = await base('Cases')
      .select({
        filterByFormula: `AND({case_id} = '${case_id}', LOWER({seller_email}) = '${normalizedEmail}', {channel} = 'email_forwarded')`,
        maxRecords: 1,
      })
      .firstPage();

    if (records.length === 0) {
      console.warn('[inbound-parse-relay] no matching case', { case_id, seller_email: normalizedEmail });
      response.setStatusCode(404);
      response.setBody({ error: 'case_not_found' });
      return callback(null, response);
    }

    const record = records[0];
    const conversationSid = record.get('conversation_sid');
    if (!conversationSid) {
      response.setStatusCode(409);
      response.setBody({ error: 'case_has_no_conversation' });
      return callback(null, response);
    }

    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);
    // Default xTwilioWebhookEnabled=false so this REST-created seller message
    // does not trigger outbound-email-forwarded (which would echo back to the
    // seller). SDK sends by the associate still fire the webhook normally.
    // Store threading headers on the message attributes so the next outbound
    // can chain In-Reply-To / References correctly.
    const messageAttrs = {};
    if (message_id) messageAttrs.messageId = message_id;
    if (in_reply_to) messageAttrs.inReplyTo = in_reply_to;
    if (referencesArr.length) messageAttrs.references = referencesArr;

    await client.conversations.v1
      .services(context.CONVERSATIONS_SERVICE_SID)
      .conversations(conversationSid)
      .messages.create({
        author: normalizedEmail,
        body: message,
        ...(Object.keys(messageAttrs).length ? { attributes: JSON.stringify(messageAttrs) } : {}),
      });

    // Update conversation-level threading state so the associate's next reply
    // uses this seller message as the parent in the RFC chain.
    if (message_id) {
      const convo = await client.conversations.v1
        .services(context.CONVERSATIONS_SERVICE_SID)
        .conversations(conversationSid)
        .fetch();
      let convAttrs = {};
      try { convAttrs = JSON.parse(convo.attributes || '{}'); } catch (_) {}
      const priorRefs = Array.isArray(convAttrs.threading?.references) ? convAttrs.threading.references : [];
      const nextRefs = referencesArr.length ? Array.from(new Set([...priorRefs, ...referencesArr, message_id])) : [...priorRefs, message_id];
      const updatedAttrs = {
        ...convAttrs,
        threading: { lastMessageId: message_id, references: nextRefs },
      };
      await client.conversations.v1
        .services(context.CONVERSATIONS_SERVICE_SID)
        .conversations(conversationSid)
        .update({ attributes: JSON.stringify(updatedAttrs) });
    }

    response.setBody({ ok: true, conversation_sid: conversationSid });
    return callback(null, response);
  } catch (err) {
    console.error('[inbound-parse-relay]', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
