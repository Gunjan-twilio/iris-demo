const twilio = require('twilio');

// Aggregates the full email thread for a case_id across all conversations.
// Each seller reply after close-on-send lands on a fresh ghost conversation
// (Twilio's expected inbound behavior for closed convs). This endpoint walks
// TaskRouter for every task tagged with the case_id, collects the unique
// conversation SIDs from their attributes, fetches messages from each, and
// returns a merged, chronologically-sorted timeline.
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

    // 1. Every task ever tagged with this case_id.
    const tasks = await client.taskrouter.v1
      .workspaces(context.WORKSPACE_SID)
      .tasks.list({
        evaluateTaskAttributes: `case_id == "${caseId}"`,
        limit: 50,
      });

    // 2. Collect unique conversation SIDs — from task attrs and any
    // originalConversationSid the reply-routing function stamped on.
    const convSids = new Set();
    for (const t of tasks) {
      let a = {};
      try { a = JSON.parse(t.attributes || '{}'); } catch (_) {}
      if (a.conversationSid) convSids.add(a.conversationSid);
      if (a.originalConversationSid) convSids.add(a.originalConversationSid);
      if (a.sourceConversationSid) convSids.add(a.sourceConversationSid);
    }

    // 3. Pull metadata + messages from each conversation in parallel.
    const conversations = [];
    const allMessages = [];
    await Promise.all(
      [...convSids].map(async (sid) => {
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

          for (const m of messages) {
            let mediaHtmlSid = null;
            let mediaPlainSid = null;
            const media = m.media || [];
            for (const mm of media) {
              if (mm.content_type === 'text/html' || mm.contentType === 'text/html') {
                mediaHtmlSid = mm.sid;
              } else if (mm.content_type === 'text/plain' || mm.contentType === 'text/plain') {
                mediaPlainSid = mm.sid;
              }
            }
            allMessages.push({
              sid: m.sid,
              conversationSid: sid,
              author: m.author,
              body: m.body || '',
              dateCreated: m.dateCreated,
              index: m.index,
              mediaHtmlSid,
              mediaPlainSid,
              subject: (m.attributes && (() => {
                try { return JSON.parse(m.attributes).subject; } catch (_) { return null; }
              })()) || null,
            });
          }
        } catch (err) {
          console.warn(`[get-case-thread] fetch failed for ${sid}:`, err.message);
        }
      })
    );

    // 4. Sort chronologically.
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
