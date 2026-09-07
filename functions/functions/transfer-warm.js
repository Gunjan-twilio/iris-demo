const twilio = require('twilio');

// DISABLED — kept for future need. TransferMenu.jsx's Warm button now calls
// add-participant.js instead, which creates the consult task via <Enqueue>
// (see enqueue.js) so it always has a real live call attached. This file is
// left working and untouched in case that mechanism needs to be reverted.
//
// Warm transfer: holds the customer in the current conference, then creates a
// brand-new consult Task directly via the TaskRouter REST API (not a
// redirected call leg — a call leg added as a Conference Participant stays
// tied to the ORIGINAL conference's lifecycle even after its own TwiML
// redirects away, so it gets torn down as soon as that conference ends).
// The target associate's frontend accepts this task with a `call` instruction
// (see AssociatePanel.jsx's isWarmConsult branch), which places an outbound
// call to them and, once answered, joins them into the SAME conference as
// the held customer and the original associate via transfer-join-conference.js.
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
    const conferenceSid = attrs.conference?.sid;
    const customerCallSid = attrs.conference?.participants?.customer || attrs.call_sid;

    if (!conferenceSid || !customerCallSid) {
      response.setStatusCode(400);
      response.setBody({ error: 'Task is not conference-based; cannot warm transfer' });
      return callback(null, response);
    }

    await client.conferences(conferenceSid).participants(customerCallSid).update({ hold: true });

    const originalAttrs = { ...attrs };
    delete originalAttrs.reservation_attributes;
    delete originalAttrs.isCallback;
    delete originalAttrs.outbound_to;
    delete originalAttrs.direction;
    delete originalAttrs.originating_case;
    delete originalAttrs.conference;

    const workflowSid = context.TRANSFER_WORKFLOW_SID || context.WORKFLOW_SID;
    await client.taskrouter.v1
      .workspaces(context.WORKSPACE_SID)
      .tasks.create({
        workflowSid,
        taskChannel: 'voice',
        routingTarget: workflowSid,
        attributes: JSON.stringify({
          ...originalAttrs,
          transferTargetQueueSid: targetQueueSid,
          isWarmConsult: true,
          originalTaskSid: taskSid,
          name: `Warm Transfer: ${originalAttrs.seller_name || ''}`,
        }),
      });

    response.setBody({ success: true });
    return callback(null, response);
  } catch (err) {
    console.error('[transfer-warm]', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
