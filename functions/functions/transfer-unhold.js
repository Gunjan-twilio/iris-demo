const twilio = require('twilio');

// Resumes the customer's audio in the original conference after a warm
// transfer consult — either to bring them into a 3-way conversation with the
// new associate, or right before the original associate hangs up.
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
    const task = await client.taskrouter.v1
      .workspaces(context.WORKSPACE_SID)
      .tasks(taskSid)
      .fetch();

    const attrs = JSON.parse(task.attributes || '{}');
    const conferenceSid = attrs.conference?.sid;
    const customerCallSid = attrs.conference?.participants?.customer || attrs.call_sid;

    if (!conferenceSid || !customerCallSid) {
      response.setStatusCode(400);
      response.setBody({ error: 'Task is not conference-based; nothing to resume' });
      return callback(null, response);
    }

    await client.conferences(conferenceSid).participants(customerCallSid).update({ hold: false });

    response.setBody({ success: true });
    return callback(null, response);
  } catch (err) {
    console.error('[transfer-unhold]', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
