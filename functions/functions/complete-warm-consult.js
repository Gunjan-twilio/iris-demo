const twilio = require('twilio');

// Completes a sequential-two-conference warm transfer (see
// start-warm-consult.js). Called when Agent 1 clicks "Complete transfer"
// after privately briefing Agent 2 in Conference 2. Agent 1's frontend never
// accepted Task 2, so the only handle it has is the ORIGINAL task's SID —
// Task 2 is discovered via EvaluateTaskAttributes. Once found, Agent 1's own
// Conference 2 participant is flipped to endConferenceOnExit:false (same
// reason as start-warm-consult.js: Agent 1 is about to leave and Conference 2
// must survive for Agent 2 + the seller), then the seller's call is
// redirected out of Conference 1 into Conference 2 — turning {Agent 1,
// Agent 2} into {Agent 2, Seller} without ever having all three together.
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

  const { originalTaskSid } = event;
  if (!originalTaskSid) {
    response.setStatusCode(400);
    response.setBody({ error: 'originalTaskSid is required' });
    return callback(null, response);
  }

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);
    const workflowSid = context.TRANSFER_WORKFLOW_SID || context.WORKFLOW_SID;

    const consultTasks = await client.taskrouter.v1
      .workspaces(context.WORKSPACE_SID)
      .tasks.list({
        workflowSid,
        evaluateTaskAttributes: `originalTaskSid == '${originalTaskSid}'`,
        limit: 1,
      });

    const task2 = consultTasks[0];
    if (!task2) {
      response.setStatusCode(400);
      response.setBody({ error: 'No consult task found for this transfer yet — has Agent 2 accepted?' });
      return callback(null, response);
    }

    const task2Attrs = JSON.parse(task2.attributes || '{}');
    const conference2Sid = task2Attrs.conference?.sid;
    const agent1CallSid = task2Attrs.conference?.participants?.customer;
    const agent2CallSid = task2Attrs.conference?.participants?.worker;

    if (!conference2Sid || !agent1CallSid) {
      response.setStatusCode(400);
      response.setBody({ error: 'Consult task has no associated conference yet — has Agent 2 accepted?' });
      return callback(null, response);
    }

    await client.conferences(conference2Sid).participants(agent1CallSid).update({ endConferenceOnExit: false });

    // Agent 2's own leg should default to endConferenceOnExit:true (same
    // TaskRouter worker-leg default start-warm-consult.js relies on for
    // Agent 1 in Conference 1), but that default alone wasn't tearing down
    // Conference 2 for the seller when Agent 2 hung up first — set it
    // explicitly here so it's not left to an ambiguous default once Agent 2
    // is about to be the only TaskRouter-tracked leg left in the room.
    if (agent2CallSid) {
      try {
        await client.conferences(conference2Sid).participants(agent2CallSid).update({ endConferenceOnExit: true });
      } catch (err) {
        console.warn('[complete-warm-consult] agent2 endConferenceOnExit flip failed', err.message);
      }
    }

    const task1 = await client.taskrouter.v1
      .workspaces(context.WORKSPACE_SID)
      .tasks(originalTaskSid)
      .fetch();
    const task1Attrs = JSON.parse(task1.attributes || '{}');
    const conference1Sid = task1Attrs.conference?.sid;
    const sellerCallSid = task1Attrs.conference?.participants?.customer || task1Attrs.call_sid;

    if (conference1Sid && sellerCallSid) {
      try {
        await client.conferences(conference1Sid).participants(sellerCallSid).update({ hold: false });
      } catch (err) {
        console.warn('[complete-warm-consult] seller unhold failed', err.message);
      }
    }

    const joinUrl = `https://${context.DOMAIN_NAME}/transfer-join-conference?taskSid=${encodeURIComponent(task2.sid)}`;
    await client.calls(sellerCallSid).update({ url: joinUrl, method: 'GET' });

    response.setBody({ success: true, task2Sid: task2.sid });
    return callback(null, response);
  } catch (err) {
    console.error('[complete-warm-consult]', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
