const twilio = require('twilio');

// Agent 1's own worker leg joins a warm-transfer conference with
// TaskRouter's default endConferenceOnExit:true, so a bare "Complete
// Transfer" disconnect ends the shared conference for Agent 2 + the seller
// too. The Flex SDK has no client action to flip that flag on an existing
// participant (HoldVoiceParticipant/UnholdVoiceParticipant only toggle
// hold), so this endpoint does it via the REST API before the associate
// hangs up.
//
// `taskSid` must be the ORIGINAL task's SID (see transfer-warm.js/
// end-conference.js) and `callSid` must be Agent 1's own leg, resolved
// client-side via GetTaskParticipants(taskSid) since Agent 2's ad-hoc
// conference join (transfer-join-conference.js) is never tracked by
// TaskRouter and won't show up there.
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

  const { taskSid, callSid } = event;
  if (!taskSid || !callSid) {
    response.setStatusCode(400);
    response.setBody({ error: 'taskSid and callSid are required' });
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
    if (!conferenceSid) {
      response.setStatusCode(400);
      response.setBody({ error: 'Task has no associated conference' });
      return callback(null, response);
    }

    await client.conferences(conferenceSid).participants(callSid).update({ endConferenceOnExit: false });

    response.setBody({ success: true });
    return callback(null, response);
  } catch (err) {
    console.error('[leave-conference]', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
