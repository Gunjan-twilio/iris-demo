const twilio = require('twilio');
const Airtable = require('airtable');

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

  const { task_sid, reservation_sid, channel, seller_phone, seller_email, case_id, conversation_sid: existing_conversation_sid, worker_name, associate_identity } = event;

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
