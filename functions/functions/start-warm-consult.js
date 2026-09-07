const twilio = require('twilio');

// Warm transfer (sequential two-conference mode) — starts a private consult
// between Agent 1 and a new Agent 2, without ever putting Agent 1, Agent 2,
// and the seller in the same conference. Holds the seller in Conference 1,
// flips Agent 1's own Conference 1 participant to endConferenceOnExit:false
// (TaskRouter's default for a worker leg is true — left alone, redirecting
// Agent 1 away in the next step would end Conference 1 and drop the seller),
// then REST-redirects Agent 1's OWN live call leg into /enqueue. That parks
// Agent 1 as a real Task (see enqueue.js) with a real live call already
// attached; whichever associate accepts it lands in a brand-new
// Flex-auto-created Conference 2 with Agent 1 (see AssociatePanel.jsx's plain
// call_now accept branch — TaskRouter auto-dequeues Agent 1's parked leg into
// it). Supersedes add-participant.js, which required a phantom conference
// participant to get audio into a second conference; here Agent 1's own leg
// IS the audio, so no phantom leg or anchor-hangup bookkeeping is needed.
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

  const { taskSid, targetQueueSid, agent1CallSid } = event;
  if (!taskSid || !targetQueueSid || !agent1CallSid) {
    response.setStatusCode(400);
    response.setBody({ error: 'taskSid, targetQueueSid and agent1CallSid are required' });
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
    const sellerCallSid = attrs.conference?.participants?.customer || attrs.call_sid;

    if (!conferenceSid || !sellerCallSid) {
      response.setStatusCode(400);
      response.setBody({ error: 'Task is not conference-based; cannot warm transfer' });
      return callback(null, response);
    }

    await client.conferences(conferenceSid).participants(sellerCallSid).update({ hold: true });
    await client.conferences(conferenceSid).participants(agent1CallSid).update({ endConferenceOnExit: false });

    const enqueueUrl =
      `https://${context.DOMAIN_NAME}/enqueue` +
      `?originalTaskSid=${encodeURIComponent(taskSid)}` +
      `&targetQueueSid=${encodeURIComponent(targetQueueSid)}` +
      `&mode=cold`;

    await client.calls(agent1CallSid).update({ url: enqueueUrl, method: 'GET' });

    response.setBody({ success: true });
    return callback(null, response);
  } catch (err) {
    console.error('[start-warm-consult]', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
