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

  const { case_id, resolve } = event;
  const isResolve = resolve === true || resolve === 'true';
  const newStatus = isResolve ? 'resolved' : 'wip';

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);
    const base = new Airtable({ apiKey: context.AIRTABLE_API_KEY }).base(context.AIRTABLE_BASE_ID);

    const records = await base('Cases').select({ filterByFormula: `{case_id} = '${case_id}'` }).firstPage();

    if (records.length > 0) {
      const fields = records[0].fields;
      await base('Cases').update(records[0].id, { status: newStatus });

      // Always complete the TaskRouter task to free worker capacity
      if (fields.task_sid) {
        try {
          await client.taskrouter.v1
            .workspaces(context.WORKSPACE_SID)
            .tasks(fields.task_sid)
            .update({ assignmentStatus: 'completed', reason: 'resolved by associate' });
        } catch (e) {
          // Task may already be completed
        }
      }
    }

    response.setBody({ success: true, status: newStatus });
    return callback(null, response);
  } catch (err) {
    console.error(err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
