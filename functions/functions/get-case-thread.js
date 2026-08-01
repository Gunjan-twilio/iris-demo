const twilio = require('twilio');
const Airtable = require('airtable');

// Aggregates the full email thread for a case_id across all conversations.
// Each seller reply after close-on-send lands on a fresh ghost conversation.
// The persistent index lives on the Airtable Cases row (conversation_sids —
// comma-separated). create-task.js writes the initial SID; route-inbound-reply.js
// appends ghost SIDs as replies arrive. This endpoint reads that list and pulls
// messages from each Conversation directly — no TaskRouter walk.
//
// GET /get-case-thread?case_id=CASE-XXX
exports.handler = async function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Access-Control-Allow-Origin', '*');
  response.appendHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.appendHeader('Content-Type', 'application/json');

  if (event.httpMethod === 'OPTIONS') {
    response.setStatusCode(200);
    return callback(null, response);
  }

  const caseId = event.case_id || event.caseId;
  if (!caseId) {
    response.setStatusCode(400);
    response.setBody({ error: 'case_id is required' });
    return callback(null, response);
  }

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);
    const SVC = context.CONVERSATIONS_SERVICE_SID;

    const base = new Airtable({ apiKey: context.AIRTABLE_API_KEY }).base(context.AIRTABLE_BASE_ID);
    const records = await base('Cases')
      .select({ filterByFormula: `{case_id} = '${caseId}'`, maxRecords: 1 })
      .firstPage();

    if (records.length === 0) {
      response.setBody({ case_id: caseId, conversationCount: 0, conversations: [], messageCount: 0, messages: [] });
      return callback(null, response);
    }

    const r = records[0].fields;
    // Backfill: pre-index rows only had conversation_sid; treat it as the seed.
    const indexed = String(r.conversation_sids || '').split(',').map((s) => s.trim()).filter(Boolean);
    const primary = String(r.conversation_sid || '').trim();
    const convSids = [...new Set([...(primary ? [primary] : []), ...indexed])];

    const conversations = [];
    const allMessages = [];
    await Promise.all(
      convSids.map(async (sid) => {
        try {
          const conv = await client.conversations.v1
            .services(SVC)
            .conversations(sid)
            .fetch();
          conversations.push({
            sid,
            state: conv.state,
            dateCreated: conv.dateCreated,
            projectedAddress: conv.bindings?.email?.projected_address || null,
          });

          const messages = await client.conversations.v1
            .services(SVC)
            .conversations(sid)
            .messages.list({ limit: 100 });

          // email_hybrid outbound uses prepareMessage().setEmailBody() which
          // stores content as media attachments — the message's `body` is
          // empty. Fetch those media contents so the frontend can render.
          await Promise.all(messages.map(async (m) => {
            let mediaHtmlSid = null;
            let mediaPlainSid = null;
            const media = m.media || [];
            for (const mm of media) {
              const ct = mm.content_type || mm.contentType;
              if (ct === 'text/html') mediaHtmlSid = mm.sid;
              else if (ct === 'text/plain') mediaPlainSid = mm.sid;
            }
            let htmlContent = null;
            let plainContent = null;
            if (mediaHtmlSid) htmlContent = await fetchMediaContent(context, mediaHtmlSid).catch(() => null);
            if (mediaPlainSid) plainContent = await fetchMediaContent(context, mediaPlainSid).catch(() => null);
            allMessages.push({
              sid: m.sid,
              conversationSid: sid,
              author: m.author,
              body: m.body || plainContent || '',
              htmlContent,
              dateCreated: m.dateCreated,
              index: m.index,
              mediaHtmlSid,
              mediaPlainSid,
              subject: (m.attributes && (() => {
                try { return JSON.parse(m.attributes).subject; } catch (_) { return null; }
              })()) || null,
            });
          }));
        } catch (err) {
          console.warn(`[get-case-thread] fetch failed for ${sid}:`, err.message);
        }
      })
    );

    allMessages.sort((a, b) => new Date(a.dateCreated) - new Date(b.dateCreated));
    conversations.sort((a, b) => new Date(a.dateCreated) - new Date(b.dateCreated));

    response.setBody({
      case_id: caseId,
      conversationCount: conversations.length,
      conversations,
      messageCount: allMessages.length,
      messages: allMessages,
    });
    return callback(null, response);
  } catch (err) {
    console.error('[get-case-thread]', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};

async function fetchMediaContent(context, mediaSid) {
  const auth = Buffer.from(`${context.ACCOUNT_SID}:${context.AUTH_TOKEN}`).toString('base64');
  const metaRes = await fetch(
    `https://mcs.us1.twilio.com/v1/Services/${context.CONVERSATIONS_SERVICE_SID}/Media/${mediaSid}`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  if (!metaRes.ok) throw new Error(`MCS meta ${metaRes.status}`);
  const meta = await metaRes.json();
  const tempUrl = meta.links?.content_direct_temporary || meta.links?.content_temporary;
  if (!tempUrl) throw new Error('no temp url in MCS response');
  const contentRes = await fetch(tempUrl);
  if (!contentRes.ok) throw new Error(`MCS content ${contentRes.status}`);
  return await contentRes.text();
}

