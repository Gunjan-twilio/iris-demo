const twilio = require('twilio');

// Cold transfer: redirects the customer's live call straight into the transfer
// workflow via transfer-enqueue.js. This ends their participation in the
// current conference immediately and creates a brand-new Task in the target
// queue. Does NOT touch the associate's own leg — the frontend disconnects
// that separately once this succeeds, since cold transfer is a full handoff.
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

  const { taskSid, targetQueueSid } = event;
  if (!taskSid || !targetQueueSid) {
    response.setStatusCode(400);
    response.setBody({ error: 'taskSid and targetQueueSid are required' });
    return callback(null, response);
  }

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);
    const task = await client.taskrouter.v1
      .workspaces(context.WORKSPACE_SID)
      .tasks(taskSid)
      .fetch();

    const attrs = JSON.parse(task.attributes || '{}');
    const customerCallSid = attrs.conference?.participants?.customer || attrs.call_sid;

    if (!customerCallSid) {
      response.setStatusCode(400);
      response.setBody({ error: 'Task has no associated customer call to transfer' });
      return callback(null, response);
    }

    const enqueueUrl =
      `https://${context.DOMAIN_NAME}/transfer-enqueue` +
      `?taskSid=${encodeURIComponent(taskSid)}` +
      `&targetQueueSid=${encodeURIComponent(targetQueueSid)}` +
      `&mode=cold`;

    await client.calls(customerCallSid).update({ url: enqueueUrl, method: 'GET' });

    response.setBody({ success: true });
    return callback(null, response);
  } catch (err) {
    console.error('[transfer-cold]', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
