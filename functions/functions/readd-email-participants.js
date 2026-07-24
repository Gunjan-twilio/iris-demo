const twilio = require('twilio');

// Called by the frontend AFTER the SendGrid send completes (success or failure)
// to restore the to/cc email participants that were stripped by
// remove-email-participants. Idempotent — 409 (already exists) is not an error.
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
    const conversation = await client.conversations.v1
      .services(context.CONVERSATIONS_SERVICE_SID)
      .conversations(conversationSid)
      .fetch();

    let attrs = {};
    try { attrs = JSON.parse(conversation.attributes || '{}'); } catch (_) {}
    const emailMetadata = attrs.emailMetadata || {};

    const toAddrs = (emailMetadata.to || '').split(',').map((s) => s.trim()).filter(Boolean);
    const ccAddrs = (emailMetadata.cc || '').split(',').map((s) => s.trim()).filter(Boolean);

    const results = { added: [], skipped: [], failed: [] };

    const addOne = async (address, level) => {
      try {
        await client.conversations.v1
          .services(context.CONVERSATIONS_SERVICE_SID)
          .conversations(conversationSid)
          .participants.create({
            'messagingBinding.address': address,
            'messagingBinding.type': 'email',
            'messagingBinding.level': level,
          });
        results.added.push({ address, level });
      } catch (err) {
        // 50433 = participant already exists / 50438 = binding conflict — both benign
        if (err.code === 50433 || err.code === 50438 || String(err.status) === '409') {
          results.skipped.push({ address, level, reason: 'exists' });
        } else {
          console.error('[readd-email-participants] add failed', address, level, err.code, err.message);
          results.failed.push({ address, level, code: err.code, message: err.message });
        }
      }
    };

    for (const a of toAddrs) await addOne(a, 'to');
    for (const a of ccAddrs) await addOne(a, 'cc');

    response.setBody({ ok: true, ...results });
    return callback(null, response);
  } catch (err) {
    console.error('[readd-email-participants]', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
