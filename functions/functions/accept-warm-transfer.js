const twilio = require('twilio');

// Warm transfer step 3 — called right after the target associate's native AcceptTask
// on Task 2. Deliberately separate from accept-reservation.js's announceOnSellerConnect:
// that pattern only whispers a <Say> into an existing leg. Here we actually bridge the
// target associate into the ORIGINAL call's conference (friendlyName == originalTaskSid),
// which is the only documented way to get a third party into that conference's audio.
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

  const { task_sid, original_task_sid, transfer_call_sid, agent_contact_uri } = event;

  if (!task_sid || !original_task_sid || !agent_contact_uri) {
    response.setStatusCode(400);
    response.setBody({ error: 'task_sid, original_task_sid and agent_contact_uri are required' });
    return callback(null, response);
  }

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);

    await client.conferences(original_task_sid).participants.create({
      to: agent_contact_uri,
      from: context.TWILIO_PHONE_NUMBER,
      earlyMedia: true,
      endConferenceOnExit: false,
    });

    if (transfer_call_sid) {
      try {
        await client.calls(transfer_call_sid).update({ status: 'completed' });
      } catch (err) {
        console.warn('[accept-warm-transfer] failed to hang up parked leg', transfer_call_sid, err.message);
      }
    }

    try {
      await client.taskrouter.v1
        .workspaces(context.WORKSPACE_SID)
        .tasks(task_sid)
        .update({ assignmentStatus: 'wrapping', reason: 'warm transfer bridged' });
    } catch (err) {
      console.warn('[accept-warm-transfer] failed to move task 2 to wrapping', err.message);
    }

    response.setBody({ success: true });
    return callback(null, response);
  } catch (err) {
    console.error('[accept-warm-transfer]', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
