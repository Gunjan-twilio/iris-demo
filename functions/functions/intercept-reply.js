const twilio = require('twilio');

// ============================================================================
// TEMPORARY WORKAROUND — DO NOT RELY ON FOR PRODUCTION
// ----------------------------------------------------------------------------
// Twilio Flex Email routes inbound messages by matching the To header against
// a per-conversation projected_address. It does NOT route by RFC In-Reply-To
// / References even though it captures them into ChannelMetadata. As a result,
// every seller reply to our branded Reply-To (support@gunjanigupta.com) creates
// a NEW "ghost" conversation + task instead of appending to the original.
//
// This interceptor plugs into the inbound Studio Flow. It reads the incoming
// message's In-Reply-To (or the tail of References as a fallback), looks it
// up in the `email_message_map` Sync Map that send-hybrid-email.js populated
// on outbound, copies the seller's message into the ORIGINAL conversation,
// and closes the ghost conversation before Studio invokes the Send-to-Flex
// widget. If no match is found the flow falls through to the normal
// new-task-creation path.
//
// TODO(permanent-fix): replace with native Twilio Flex In-Reply-To routing
// once available (open feature request / support ticket).
// ============================================================================

const SYNC_MAP_NAME = 'email_message_map';

exports.handler = async function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'application/json');

  const conversationSid = event.conversationSid || event.ConversationSid;
  if (!conversationSid) {
    response.setBody({ matched: false, reason: 'no_conversation_sid' });
    return callback(null, response);
  }

  const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);
  const syncServiceSid = context.SYNC_SERVICE_SID || 'default';

  try {
    // Fetch the first inbound message. Studio invokes this function on
    // "Incoming Conversation" but the message may not be committed yet, so
    // retry briefly.
    const firstMessage = await fetchFirstMessageWithRetry(client, context.CONVERSATIONS_SERVICE_SID, conversationSid);
    if (!firstMessage) {
      response.setBody({ matched: false, reason: 'no_message_yet' });
      return callback(null, response);
    }

    const cm = await fetchChannelMetadata(context, conversationSid, firstMessage.sid).catch(() => null);
    const cmData = cm?.data || {};
    const inReplyTo = normalizeMessageId(cmData.in_reply_to);
    const referencesTail = normalizeMessageId(lastReference(cmData.references));
    const lookupKey = inReplyTo || referencesTail;

    if (!lookupKey) {
      response.setBody({ matched: false, reason: 'no_in_reply_to' });
      return callback(null, response);
    }

    // Lookup the referenced Message-Id in the Sync Map.
    let mapping;
    try {
      const item = await client.sync.v1
        .services(syncServiceSid)
        .syncMaps(SYNC_MAP_NAME)
        .syncMapItems(lookupKey)
        .fetch();
      mapping = item.data;
    } catch (err) {
      if (err.status === 404) {
        response.setBody({ matched: false, reason: 'no_sync_mapping', lookupKey });
        return callback(null, response);
      }
      throw err;
    }

    const targetSid = mapping?.conversationSid;
    if (!targetSid || targetSid === conversationSid) {
      response.setBody({ matched: false, reason: 'invalid_mapping' });
      return callback(null, response);
    }

    // Reactivate target if it was closed.
    const target = await client.conversations.v1
      .services(context.CONVERSATIONS_SERVICE_SID)
      .conversations(targetSid)
      .fetch()
      .catch(() => null);
    if (!target) {
      response.setBody({ matched: false, reason: 'target_gone', targetSid });
      return callback(null, response);
    }
    if (target.state === 'closed') {
      await client.conversations.v1
        .services(context.CONVERSATIONS_SERVICE_SID)
        .conversations(targetSid)
        .update({ state: 'active' });
    }

    // Copy the seller's message into the original conversation. Skip the
    // outbound webhook so this doesn't loop through outbound-email-forwarded
    // (not relevant for email_hybrid but defensive).
    const seller = firstMessage.author || cmData.from || '';
    const bodyToCopy = firstMessage.body || cmData.text || '';
    await client.conversations.v1
      .services(context.CONVERSATIONS_SERVICE_SID)
      .conversations(targetSid)
      .messages.create({
        author: seller,
        body: bodyToCopy,
        attributes: JSON.stringify({
          copiedFromGhost: conversationSid,
          originalMessageId: cmData.message_id,
        }),
      });

    // Mark the ghost conversation and close it. The Studio Flow branch on
    // matched=true routes to Disconnect so no Flex task is created.
    let ghostAttrs = {};
    try { ghostAttrs = JSON.parse(target.attributes || '{}'); } catch (_) {}
    await client.conversations.v1
      .services(context.CONVERSATIONS_SERVICE_SID)
      .conversations(conversationSid)
      .update({
        state: 'closed',
        attributes: JSON.stringify({
          ...ghostAttrs,
          ghost: true,
          mergedInto: targetSid,
          mergedBy: 'intercept-reply',
        }),
      });

    response.setBody({
      matched: true,
      targetConversationSid: targetSid,
      copiedMessageBody: bodyToCopy.length,
    });
    return callback(null, response);
  } catch (err) {
    console.error('[intercept-reply]', err);
    // Fail-open: return matched:false so Studio Flow falls through to normal task creation.
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

// Trim + strip angle brackets so `<abc@x>` and `abc@x` map to the same Sync key.
function normalizeMessageId(id) {
  if (!id) return '';
  return String(id).trim().replace(/^</, '').replace(/>$/, '');
}

// References is a space-separated list; the immediate parent is the last one.
function lastReference(refs) {
  if (!refs) return '';
  const parts = String(refs).trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}
