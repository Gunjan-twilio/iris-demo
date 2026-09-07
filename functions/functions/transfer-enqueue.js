const twilio = require('twilio');

// TwiML endpoint that parks the customer's call leg into the transfer
// workflow's queue as a brand-new Task — used by cold transfer, which
// redirects the customer's own live call here (see transfer-cold.js). Warm
// transfer parks Agent 1's own live call leg the same way, but via a
// separate endpoint (see enqueue.js) since its Task attributes differ
// (originalTaskSid instead of a plain queue handoff).
exports.handler = async function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'text/xml');

  const { taskSid, targetQueueSid } = event;
  const twiml = new Twilio.twiml.VoiceResponse();

  if (!taskSid || !targetQueueSid) {
    twiml.say('Transfer setup failed. Missing task information.');
    response.setBody(twiml.toString());
    return callback(null, response);
  }

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);
    const task = await client.taskrouter.v1
      .workspaces(context.WORKSPACE_SID)
      .tasks(taskSid)
      .fetch();

    const originalAttributes = JSON.parse(task.attributes || '{}');
    delete originalAttributes.reservation_attributes;

    // Strip fields specific to the isCallback (v2) origin task. If a
    // transferred task kept isCallback/outbound_to, the target associate's
    // accept would go through AssociatePanel's AcceptTask branch, which lets
    // Flex auto-dial `outbound_to` again — a duplicate call to the customer,
    // since the real customer leg is already parked in this conference via
    // the redirected/probe call. Dropping these makes every transferred task
    // look like a plain v1 call_now task, so the target associate always
    // accepts via `reservation.conference()`, which only joins the existing
    // conference.sid instead of dialing anyone. `direction`/`originating_case`
    // must go too — left alone, they'd make AssociatePanel's silent outbound
    // monitor swallow the reservation before the accept UI ever shows.
    delete originalAttributes.isCallback;
    delete originalAttributes.outbound_to;
    delete originalAttributes.direction;
    delete originalAttributes.originating_case;

    const attributes = {
      ...originalAttributes,
      transferTargetQueueSid: targetQueueSid,
      name: `Cold Transfer: ${originalAttributes.seller_name || ''}`,
    };

    const workflowSid = context.TRANSFER_WORKFLOW_SID || context.WORKFLOW_SID;
    const enqueue = twiml.enqueue({ workflowSid });
    enqueue.task({}, JSON.stringify(attributes));

    response.setBody(twiml.toString());
    return callback(null, response);
  } catch (err) {
    console.error('[transfer-enqueue]', err);
    twiml.say('Transfer setup failed.');
    response.setBody(twiml.toString());
    return callback(null, response);
  }
};
