const twilio = require('twilio');
const Airtable = require('airtable');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Flex's SDK bridges the associate + seller into a conference (named by the
// Task SID) internally for the call_now callback flow — there's no exposed
// hook to inject TwiML the moment the seller's leg answers. So we poll the
// live conference for the seller joining, then push a <Say> into it via the
// Conference "Announce" API. Best-effort: any failure here must not affect
// the rest of accept-reservation (Airtable update, response).
async function announceOnSellerConnect(client, context, task_sid) {
  const maxAttempts = 6;
  const delayMs = 1500;

  let conferenceSid = null;
  for (let attempt = 0; attempt < maxAttempts && !conferenceSid; attempt++) {
    if (attempt > 0) await sleep(delayMs);
    const conferences = await client.conferences.list({
      friendlyName: task_sid,
      status: 'in-progress',
      limit: 1,
    });
    if (conferences.length > 0) conferenceSid = conferences[0].sid;
  }

  if (!conferenceSid) {
    console.warn('[call_now announce] conference not found for task', task_sid);
    return;
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(delayMs);
    const participants = await client.conferences(conferenceSid).participants.list();
    const sellerJoined = participants.length >= 2 && participants.every((p) => p.status === 'connected');
    if (sellerJoined) {
      // Associate's leg is dialed to `client:<worker_identity>`; the seller's
      // leg is a plain PSTN call. Fetch each connected participant's Call
      // resource and pick the one whose `to` isn't a client URI.
      const calls = await Promise.all(
        participants.map((p) => client.calls(p.callSid).fetch())
      );
      const sellerCall = calls.find((c) => !(c.to || '').startsWith('client:'));

      if (!sellerCall) {
        console.warn('[call_now announce] could not identify seller leg for conference', conferenceSid);
        return;
      }

      // Whole-conference announcement (both parties hear it) — kept here in
      // case we ever need to switch back:
      // await client.conferences(conferenceSid).update({
      //   announceUrl: `https://${context.DOMAIN_NAME}/call-now-connect-say`,
      //   announceMethod: 'GET',
      // });

      // Participant-level announcement — whispers the <Say> to the seller's
      // leg only; the associate doesn't hear it.
      await client.conferences(conferenceSid).participants(sellerCall.sid).update({
        announceUrl: `https://${context.DOMAIN_NAME}/call-now-connect-say`,
        announceMethod: 'GET',
      });
      return;
    }
  }

  console.warn('[call_now announce] seller never reached connected for conference', conferenceSid);
}

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

  const { task_sid, reservation_sid, channel, isCallback, seller_phone, seller_email, case_id, conversation_sid: existing_conversation_sid, worker_name, associate_identity } = event;

  if (!task_sid || !reservation_sid) {
    response.setStatusCode(400);
    response.setBody({ error: 'task_sid and reservation_sid are required' });
    return callback(null, response);
  }

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);

    let conversation_sid = existing_conversation_sid || null;

    if (channel === 'chat') {
      // Seller participant is added at task creation time in create-task.js

      // The seller may have clicked "End Chat" while this task was still
      // pending/reserved (before the associate accepted it). In that case
      // the conversation was already marked inactive/closed by end-chat.js,
      // but that endpoint couldn't move the task to wrapping yet because it
      // wasn't assigned. Catch it here instead of dropping the associate
      // into a chat the seller has already left.
      if (existing_conversation_sid) {
        try {
          const conv = await client.conversations.v1
            .services(context.CONVERSATIONS_SERVICE_SID)
            .conversations(existing_conversation_sid)
            .fetch();
          if (conv.state !== 'active') {
            await client.taskrouter.v1
              .workspaces(context.WORKSPACE_SID)
              .tasks(task_sid)
              .update({ assignmentStatus: 'wrapping', reason: 'seller ended chat before assignment' });
          }
        } catch (err) {
          console.warn('[accept-reservation] conversation state check failed', err.message);
        }
      }

    } else if (channel === 'email') {
      // Conversation was already created in create-task — just use it
      // conversation_sid is already set from existing_conversation_sid

    } else if (channel === 'email_forwarded') {
      // Conversation was created in create-task with only the seller as a
      // participant. Add the associate now so their ConversationsClient token
      // (issued for `associate_identity`) can fetch and send messages.
      if (existing_conversation_sid && associate_identity) {
        try {
          await client.conversations.v1
            .services(context.CONVERSATIONS_SERVICE_SID)
            .conversations(existing_conversation_sid)
            .participants.create({ identity: associate_identity });
        } catch (err) {
          // 50433 = participant already exists — safe to ignore on retry
          if (err.code !== 50433) throw err;
        }
      }

    } else if (channel === 'phone') {
      // Call is placed client-side via StartOutboundCall after AcceptTask

    } else if (channel === 'call_now' && isCallback) {
      // Callback-task pattern: Flex's SDK bridges associate + seller into a
      // conference internally. Wait for the seller's leg to connect, then
      // announce into the conference so both parties hear a greeting.
      try {
        await announceOnSellerConnect(client, context, task_sid);
      } catch (err) {
        console.warn('[call_now announce] failed', err.message);
      }
    }

    // Update Airtable
    const base = new Airtable({ apiKey: context.AIRTABLE_API_KEY }).base(context.AIRTABLE_BASE_ID);
    const records = await base('Cases').select({ filterByFormula: `{case_id} = '${case_id}'` }).firstPage();
    if (records.length > 0) {
      await base('Cases').update(records[0].id, {
        status: 'wip',
        assigned_worker: worker_name || 'Associate',
        conversation_sid: conversation_sid || '',
        task_sid,
        seller_email: seller_email || '',
        updated_at: new Date().toISOString(),
      });
    }

    response.setBody({ success: true, conversation_sid });
    return callback(null, response);
  } catch (err) {
    console.error(err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
