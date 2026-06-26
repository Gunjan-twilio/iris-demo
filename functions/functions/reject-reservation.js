const twilio = require('twilio');

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

  const { task_sid, reservation_sid } = event;

  if (!task_sid || !reservation_sid) {
    response.setStatusCode(400);
    response.setBody({ error: 'task_sid and reservation_sid are required' });
    return callback(null, response);
  }

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);

    // Try to cancel the task — works regardless of current state
    try {
      await client.taskrouter.v1
        .workspaces(context.WORKSPACE_SID)
        .tasks(task_sid)
        .update({ assignmentStatus: 'canceled', reason: 'rejected by associate' });
    } catch (e) {
      // Task may already be completed/canceled — that's fine
      console.log('Task already resolved:', e.message);
    }

    response.setBody({ success: true });
    return callback(null, response);
  } catch (err) {
    console.error(err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
