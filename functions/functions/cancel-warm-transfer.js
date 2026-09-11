const twilio = require('twilio');

// Cancel a pending warm transfer — lets Agent1 back out while Task 2 (the
// transfer target, created asynchronously by enqueue.protected.js) is still
// sitting unaccepted in the transfer workflow's queue. Finds Task 2 by the
// same call SID initiate-warm-transfer.js handed back to the caller, since
// enqueue.protected.js stamps that same CallSid onto Task 2 as
// `transferCallSid`. If Task 2 has already moved past `pending` (an agent
// accepted it), refuses so the normal complete-warm-transfer.js flow takes
// over instead.
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

  const { taskSid, transferCallSid } = event;

  if (!taskSid || !transferCallSid) {
    response.setStatusCode(400);
    response.setBody({ error: 'taskSid and transferCallSid are required' });
    return callback(null, response);
  }

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);
    const workflowSid = context.TRANSFER_WORKFLOW_SID || context.WORKFLOW_SID;

    // Plain list + client-side match — EvaluateTaskAttributes is backed by
    // TaskRouter's real-time queue index, which only contains pending/reserved
    // tasks, so it stops finding Task 2 the moment it's accepted.
    //
    // Match on originalTaskSid (Task 1's own sid), not transferCallSid: dialing
    // `to: app:APSid` in initiate-warm-transfer.js produces two distinct Call
    // resources — the outbound-api leg (whose sid is handed back to the
    // frontend as transferCallSid) and a separate inbound leg that actually
    // runs enqueue.protected.js's webhook and gets stamped onto Task 2's
    // attributes. Those sids never match each other, so transferCallSid can't
    // be used to find Task 2 — originalTaskSid can, since it's just taskSid
    // echoed back verbatim.
    const candidates = await client.taskrouter.v1
      .workspaces(context.WORKSPACE_SID)
      .tasks.list({ workflowSid, ordering: 'DateCreated:desc', limit: 50 });
    const task2 = candidates.find((t) => {
      try {
        return JSON.parse(t.attributes || '{}').originalTaskSid === taskSid;
      } catch {
        return false;
      }
    });

    if (task2 && (task2.assignmentStatus !== 'pending' && task2.assignmentStatus !== 'reserved')) {
      response.setStatusCode(409);
      response.setBody({ error: 'Transfer already in progress; cannot cancel' });
      return callback(null, response);
    }

    if (task2) {
      await client.taskrouter.v1
        .workspaces(context.WORKSPACE_SID)
        .tasks(task2.sid)
        .update({ assignmentStatus: 'canceled', reason: 'Canceled by agent before acceptance' });
    }

    try {
      await client.calls(transferCallSid).update({ status: 'completed' });
    } catch (hangupErr) {
      console.warn('[cancel-warm-transfer] failed to hang up parked leg', transferCallSid, hangupErr.message);
    }

    const task1 = await client.taskrouter.v1.workspaces(context.WORKSPACE_SID).tasks(taskSid).fetch();
    const task1Attrs = JSON.parse(task1.attributes || '{}');
    const conferenceSid = task1Attrs.conference?.sid || taskSid;
    const customerCallSid = task1Attrs.conference?.participants?.customer;

    if (customerCallSid) {
      await client.conferences(conferenceSid).participants(customerCallSid).update({ hold: false });
    } else {
      console.warn('[cancel-warm-transfer] no conference.participants.customer on task attributes', taskSid);
    }

    response.setBody({ success: true });
    return callback(null, response);
  } catch (err) {
    console.error('[cancel-warm-transfer]', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
