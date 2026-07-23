const twilio = require('twilio');

// Wired as the post-event onMessageAdded webhook on the Flex Conversation
// Service. Fires for every conversation on that service (chat included), so
// self-filter on channelType === 'email_forwarded' and Source === 'SDK'
// (associate typed in EmailForwardedThreadView). REST-created seller replies
// arrive via inbound-parse-relay with xTwilioWebhookEnabled=false — they do
// not reach this handler.
exports.handler = async function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'application/json');

  try {
    const source = (event.Source || '').toUpperCase();
    if (source !== 'SDK') {
      response.setBody({ skipped: 'not_sdk_source', source });
      return callback(null, response);
    }

    const conversationSid = event.ConversationSid;
    if (!conversationSid) {
      response.setBody({ skipped: 'no_conversation_sid' });
      return callback(null, response);
    }

    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);
    const conversation = await client.conversations.v1
      .services(context.CONVERSATIONS_SERVICE_SID)
      .conversations(conversationSid)
      .fetch();

    let attrs = {};
    try { attrs = JSON.parse(conversation.attributes || '{}'); } catch (_) {}

    if (attrs.channelType !== 'email_forwarded') {
      response.setBody({ skipped: 'not_email_forwarded', channelType: attrs.channelType || null });
      return callback(null, response);
    }

    const to = attrs.customerEmail;
    const caseId = attrs.caseId || '';
    const originalSubject = (attrs.subject || `Case ${caseId}`).replace(/^\[[^\]]+\]\s*/, '');
    const subject = caseId ? `[${caseId}] ${originalSubject}` : originalSubject;
    const bodyText = event.Body || '';

    if (!to || !bodyText.trim()) {
      response.setBody({ skipped: 'missing_to_or_body' });
      return callback(null, response);
    }

    const sgRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${context.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }], subject }],
        from: {
          email: context.FROM_EMAIL,
          name: context.FROM_DISPLAY_NAME || 'Walmart Support',
        },
        reply_to: { email: context.FROM_EMAIL },
        content: [
          { type: 'text/plain', value: bodyText },
          { type: 'text/html', value: `<div style="font-family:sans-serif;font-size:14px;color:#1a1a2e;white-space:pre-wrap">${escapeHtml(bodyText)}</div>` },
        ],
      }),
    });

    if (!sgRes.ok) {
      const errText = await sgRes.text();
      console.error('[outbound-email-forwarded] SendGrid failure', sgRes.status, errText);
      response.setStatusCode(502);
      response.setBody({ error: 'sendgrid_failed', status: sgRes.status, detail: errText });
      return callback(null, response);
    }

    response.setBody({ ok: true, to, subject });
    return callback(null, response);
  } catch (err) {
    console.error('[outbound-email-forwarded]', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
