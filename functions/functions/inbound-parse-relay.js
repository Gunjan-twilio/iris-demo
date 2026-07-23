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

  const { case_id, seller_email, subject, message } = event;
  if (!case_id || !seller_email || !message) {
    response.setStatusCode(400);
    response.setBody({ error: 'case_id, seller_email, and message are required' });
    return callback(null, response);
  }

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
    await client.conversations.v1
      .services(context.CONVERSATIONS_SERVICE_SID)
      .conversations(conversationSid)
      .messages.create({
        author: normalizedEmail,
        body: message,
      });

    response.setBody({ ok: true, conversation_sid: conversationSid });
    return callback(null, response);
  } catch (err) {
    console.error('[inbound-parse-relay]', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
