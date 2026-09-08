const twilio = require('twilio');

// Manual counterpart to unhold-seller.js — lets either agent on the call
// (Agent1 on the original task, or Agent2 once bridged into the same
// conference during a warm transfer) put the seller's leg on hold.
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

    let task = await client.taskrouter.v1.workspaces(context.WORKSPACE_SID).tasks(taskSid).fetch();
    let taskAttrs = JSON.parse(task.attributes || '{}');

    // Agent2's task is the transfer-target task created in enqueue.protected.js —
    // it never carries its own `conference` (it was bridged into Agent1's ORIGINAL
    // conference by accept-warm-transfer.js). Resolve against the original task instead.
    if (taskAttrs.transferType === 'warm' && taskAttrs.originalTaskSid) {
      task = await client.taskrouter.v1.workspaces(context.WORKSPACE_SID).tasks(taskAttrs.originalTaskSid).fetch();
      taskAttrs = JSON.parse(task.attributes || '{}');
    }

    const conferenceSid = taskAttrs.conference?.sid || task.sid;
    const customerCallSid = taskAttrs.conference?.participants?.customer;

    if (!customerCallSid) {
      response.setStatusCode(404);
      response.setBody({ error: 'No conference.participants.customer on task attributes' });
      return callback(null, response);
    }

    await client.conferences(conferenceSid).participants(customerCallSid).update({ hold: true });

    response.setBody({ success: true });
    return callback(null, response);
  } catch (err) {
    console.error('[hold-seller]', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
