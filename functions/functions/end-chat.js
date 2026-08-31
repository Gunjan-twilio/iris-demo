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

  const { conversationSid } = event;

  if (!conversationSid) {
    response.setStatusCode(400);
    response.setBody({ error: 'conversationSid is required' });
    return callback(null, response);
  }

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);
    const base = new Airtable({ apiKey: context.AIRTABLE_API_KEY }).base(context.AIRTABLE_BASE_ID);

    // Mark the conversation inactive — the associate's Conversations SDK client
    // receives this as an `updated` event (reason: state) on the conversation.
    await client.conversations.v1
      .services(context.CONVERSATIONS_SERVICE_SID)
      .conversations(conversationSid)
      .update({ state: 'inactive' });

    // Move the associate's task assigned -> wrapping (same transition EndTask
    // performs), so the associate still has to actively resolve/complete it.
    const records = await base('Cases')
      .select({ filterByFormula: `{conversation_sid} = '${conversationSid}'`, maxRecords: 1 })
      .firstPage();

    const taskSid = records[0]?.fields?.task_sid;
    if (taskSid) {
      try {
        await client.taskrouter.v1
          .workspaces(context.WORKSPACE_SID)
          .tasks(taskSid)
          .update({ assignmentStatus: 'wrapping', reason: 'seller ended chat' });
      } catch (e) {
        // Task may already be wrapping/completed if the associate acted first
      }
    }

    response.setBody({ success: true });
    return callback(null, response);
  } catch (err) {
    console.error('end-chat error:', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
