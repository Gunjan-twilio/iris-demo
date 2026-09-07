const twilio = require('twilio');

// Manual counterpart to the auto-hold in initiate-warm-transfer.js — lets
// Agent1 bring the seller back into the conference (e.g. once Agent2 has
// joined and the consult is done).
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

  const { taskSid } = event;

  if (!taskSid) {
    response.setStatusCode(400);
    response.setBody({ error: 'taskSid is required' });
    return callback(null, response);
  }

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);

    const task = await client.taskrouter.v1.workspaces(context.WORKSPACE_SID).tasks(taskSid).fetch();
    const taskAttrs = JSON.parse(task.attributes || '{}');
    const conferenceSid = taskAttrs.conference?.sid || taskSid;
    const customerCallSid = taskAttrs.conference?.participants?.customer;

    if (!customerCallSid) {
      response.setStatusCode(404);
      response.setBody({ error: 'No conference.participants.customer on task attributes' });
      return callback(null, response);
    }

    await client.conferences(conferenceSid).participants(customerCallSid).update({ hold: false });

    response.setBody({ success: true });
    return callback(null, response);
  } catch (err) {
    console.error('[unhold-seller]', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
