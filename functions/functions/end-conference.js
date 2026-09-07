const twilio = require('twilio');

// "End Call" is supposed to end the call for everyone, but a worker leg's
// endConferenceOnExit is explicitly set to false for both associates in a
// warm-transfer conference (Agent 1 flips it off in AssociatePanel.jsx's
// onWarmComplete before leaving; Agent 2's own leg is dialed with it false
// from the start in transfer-join-conference.js) so a graceful "Complete
// Transfer" handoff doesn't accidentally drop everyone else. That means
// disconnecting one associate's own leg no longer ends the conference for
// anyone — the seller is left alone on a live conference indefinitely. This
// endpoint explicitly terminates the underlying Conference so every
// remaining participant (including the seller) is hung up too.
//
// `taskSid` must be the ORIGINAL task's SID — the one the conference is
// named after and whose attributes carry `conference.sid` (see
// transfer-warm.js). A warm-transfer consult task's own attributes never
// have `conference` (transfer-warm.js strips it), so callers on a consult
// task must pass `attrs.originalTaskSid` instead of their own taskSid.
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

    if (conferenceSid) {
      try {
        await client.conferences(conferenceSid).update({ status: 'completed' });
      } catch (e) {
        // Already completed/ended by the last participant leaving — fine.
      }
    }

    response.setBody({ success: true });
    return callback(null, response);
  } catch (err) {
    console.error('[end-conference]', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
