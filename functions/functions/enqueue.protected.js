const twilio = require('twilio');

// Warm transfer step 2 — modeled on flex-workflow-transfers' enqueue.protected.js.
// Voice URL for TRANSFER_TWIML_APP_SID. Twilio requests this once the leg created by
// initiate-warm-transfer.js is placed (to: app:TRANSFER_TWIML_APP_SID?taskSid=..&targetSid=..).
// Creates Task 2 by parking this leg in the transfer workflow's queue via <Enqueue><Task>.
// This leg does NOT itself carry audio into the original conference — see accept-warm-transfer.js
// for the actual bridge, which happens once Task 2 is accepted.
exports.handler = async function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'text/xml');
  const twiml = new Twilio.twiml.VoiceResponse();

  const { taskSid, targetSid, CallSid } = event;

  if (!taskSid || !targetSid) {
    console.error('[enqueue] missing taskSid/targetSid', { taskSid, targetSid });
    twiml.say({ voice: 'Polly.Joanna' }, 'Unable to complete transfer.');
    twiml.hangup();
    response.setBody(twiml.toString());
    return callback(null, response);
  }

  let originalAttrs = {};
  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);
    const originalTask = await client.taskrouter.v1
      .workspaces(context.WORKSPACE_SID)
      .tasks(taskSid)
      .fetch();
    originalAttrs = JSON.parse(originalTask.attributes || '{}');
  } catch (err) {
    console.warn('[enqueue] failed to fetch original task', taskSid, err.message);
  }

  const transferAttrs = {
    transferType: 'warm',
    originalTaskSid: taskSid,
    targetQueueSid: targetSid,
    transferCallSid: CallSid || '',
    case_id: originalAttrs.case_id || '',
    seller_name: originalAttrs.seller_name || '',
    seller_phone: originalAttrs.seller_phone || '',
    help_category: originalAttrs.help_category || '',
    case_summary: originalAttrs.case_summary || '',
    channel: 'voice_transfer',
    name: `Warm Transfer: ${originalAttrs.seller_name || originalAttrs.case_id || taskSid}`,
  };

  const enqueue = twiml.enqueue({
    workflowSid: context.TRANSFER_WORKFLOW_SID || context.WORKFLOW_SID,
  });
  enqueue.task(JSON.stringify(transferAttrs));

  response.setBody(twiml.toString());
  return callback(null, response);
};
