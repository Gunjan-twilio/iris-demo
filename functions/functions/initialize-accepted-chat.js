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

  const { taskSid, sellerEmail, associateIdentity, caseId } = event;

  if (!taskSid || !sellerEmail || !caseId) {
    response.setStatusCode(400);
    response.setBody({ error: 'taskSid, sellerEmail, and caseId are required' });
    return callback(null, response);
  }

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);
    const base = new Airtable({ apiKey: context.AIRTABLE_API_KEY }).base(context.AIRTABLE_BASE_ID);

    // 1. Create a new Conversation in the Flex service
    const conversation = await client.conversations.v1
      .services(context.CONVERSATIONS_SERVICE_SID)
      .conversations.create({ friendlyName: caseId });

    const conversationSid = conversation.sid;

    // 2. Add the seller as a participant
    await client.conversations.v1
      .services(context.CONVERSATIONS_SERVICE_SID)
      .conversations(conversationSid)
      .participants.create({ identity: sellerEmail.toLowerCase().trim() });

    // 3. Add the associate as a participant
    const identity = associateIdentity || 'associate1';
    await client.conversations.v1
      .services(context.CONVERSATIONS_SERVICE_SID)
      .conversations(conversationSid)
      .participants.create({ identity });

    // 4. Stamp conversationSid onto the TaskRouter task attributes
    const task = await client.taskrouter.v1
      .workspaces(context.WORKSPACE_SID)
      .tasks(taskSid)
      .fetch();

    const existingAttrs = JSON.parse(task.attributes || '{}');
    await client.taskrouter.v1
      .workspaces(context.WORKSPACE_SID)
      .tasks(taskSid)
      .update({ attributes: JSON.stringify({ ...existingAttrs, conversationSid }) });

    // 5. Stamp conversationSid onto the Airtable case row
    const records = await base('Cases').select({
      filterByFormula: `{case_id} = '${caseId}'`,
      maxRecords: 1,
    }).firstPage();

    if (records.length > 0) {
      await base('Cases').update(records[0].id, { conversation_sid: conversationSid, status: 'wip', updated_at: new Date().toISOString() });
    }

    response.setBody({ conversationSid });
    return callback(null, response);

  } catch (err) {
    console.error('initialize-accepted-chat error:', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
