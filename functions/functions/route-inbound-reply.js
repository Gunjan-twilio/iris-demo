const twilio = require('twilio');
const Airtable = require('airtable');

// Studio Run Function endpoint. Fires on the Messaging Flow for inbound
// seller replies to auto-created conversations. Parses the Case ID out of
// the incoming message's In-Reply-To header (populated by ChannelMetadata),
// looks up the case in Airtable, appends this reply's conversation SID to
// conversation_sids so get-case-thread can aggregate the full timeline, and
// returns case fields so the flow's SendToFlex widget can stamp the new task.
//
// send-hybrid-email.js writes outbound Message-Ids in the form:
//   <case-{CASE-xxx}-{messageSid}@{FROM_EMAIL domain}>
// Gmail preserves that in the seller's reply as In-Reply-To.

const CASE_ID_RE = /<case-(CASE-\d+)-IM[a-f0-9]+@/i;

exports.handler = async function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'application/json');

  const conversationSid = event.conversationSid || event.ConversationSid;
  if (!conversationSid) {
    response.setBody({ matched: false, reason: 'no_conversation_sid' });
    return callback(null, response);
  }

  const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);
  const SVC = context.CONVERSATIONS_SERVICE_SID;

  try {
    const firstMessage = await fetchFirstMessageWithRetry(client, SVC, conversationSid);
    if (!firstMessage) {
      response.setBody({ matched: false, reason: 'no_message_yet' });
      return callback(null, response);
    }

    const cm = await fetchChannelMetadata(context, conversationSid, firstMessage.sid).catch(() => null);
    const cmData = cm?.data || {};
    const inReplyTo = String(cmData.in_reply_to || '');
    const references = String(cmData.references || '');

    let match = CASE_ID_RE.exec(inReplyTo);
    if (!match && references) {
      match = CASE_ID_RE.exec(references);
    }
    if (!match) {
      response.setBody({ matched: false, reason: 'no_case_id_in_headers', inReplyTo });
      return callback(null, response);
    }

    const caseId = match[1];

    const base = new Airtable({ apiKey: context.AIRTABLE_API_KEY }).base(context.AIRTABLE_BASE_ID);
    const records = await base('Cases')
      .select({ filterByFormula: `{case_id} = '${caseId}'`, maxRecords: 1 })
      .firstPage();

    if (records.length === 0) {
      response.setBody({ matched: false, reason: 'case_not_found', caseId });
      return callback(null, response);
    }

    const record = records[0];
    const r = record.fields;

    // Append the ghost conversation SID to the case's index so get-case-thread
    // can pull messages from every conversation tied to this case.
    const existing = String(r.conversation_sids || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!existing.includes(conversationSid)) {
      const merged = [...existing, conversationSid].join(',');
      try {
        await base('Cases').update(record.id, { conversation_sids: merged });
      } catch (err) {
        console.warn('[route-inbound-reply] Airtable append failed', err.message);
      }
    }

    response.setBody({
      matched: true,
      caseId,
      sourceConversationSid: conversationSid,
      inReplyTo,
      seller_name: r.seller_name || '',
      seller_email: r.seller_email || '',
      seller_phone: r.seller_phone || '',
      help_category: r.help_category || '',
      case_summary: r.case_summary || '',
      originalConversationSid: r.conversation_sid || '',
    });
    return callback(null, response);
  } catch (err) {
    console.error('[route-inbound-reply]', err);
    response.setBody({ matched: false, reason: 'error', error: err.message });
    return callback(null, response);
  }
};

async function fetchFirstMessageWithRetry(client, serviceSid, conversationSid) {
  for (let i = 0; i < 4; i++) {
    const messages = await client.conversations.v1
      .services(serviceSid)
      .conversations(conversationSid)
      .messages.list({ limit: 1, order: 'asc' });
    if (messages.length > 0) return messages[0];
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

async function fetchChannelMetadata(context, conversationSid, messageSid) {
  const auth = Buffer.from(`${context.ACCOUNT_SID}:${context.AUTH_TOKEN}`).toString('base64');
  const res = await fetch(
    `https://conversations.twilio.com/v1/Services/${context.CONVERSATIONS_SERVICE_SID}/Conversations/${conversationSid}/Messages/${messageSid}/ChannelMetadata`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  if (!res.ok) throw new Error(`ChannelMetadata ${res.status}`);
  return await res.json();
}
