const twilio = require('twilio');

// Warm transfer step 1 — modeled on flex-workflow-transfers' add-participant.js.
// Adds a participant to the ORIGINAL call's conference (friendlyName == taskSid)
// whose destination is the transfer TwiML Application, carrying taskSid/targetSid
// as query params. That Application's Voice URL (/enqueue) creates Task 2 and
// parks this new leg in the transfer workflow's queue — see enqueue.protected.js.
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

  const { taskSid, targetSid, from } = event;

  if (!taskSid || !targetSid || !from) {
    response.setStatusCode(400);
    response.setBody({ error: 'taskSid, targetSid and from are required' });
    return callback(null, response);
  }

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);

    const transferAppSid = context.TRANSFER_TWIML_APP_SID;
    if (!transferAppSid) {
      response.setStatusCode(500);
      response.setBody({ error: 'TRANSFER_TWIML_APP_SID is not configured' });
      return callback(null, response);
    }

    const to = `app:${transferAppSid}?taskSid=${encodeURIComponent(taskSid)}&targetSid=${encodeURIComponent(targetSid)}`;

    const participant = await client.conferences(taskSid).participants.create({
      to,
      from,
      earlyMedia: true,
      endConferenceOnExit: false,
    });

    // Park the seller on hold while the target queue is dialed in, so they
    // don't sit through transfer ringing/consult audio. Identify the
    // seller's leg from Task 1's own attributes (Flex writes the live
    // conference's participant CallSids back onto the task) instead of
    // guessing from the conference participant list.
    try {
      const task = await client.taskrouter.v1.workspaces(context.WORKSPACE_SID).tasks(taskSid).fetch();
      const taskAttrs = JSON.parse(task.attributes || '{}');
      const conferenceSid = taskAttrs.conference?.sid || taskSid;
      const customerCallSid = taskAttrs.conference?.participants?.customer;
      if (customerCallSid) {
        await client.conferences(conferenceSid).participants(customerCallSid).update({ hold: true });
      } else {
        console.warn('[initiate-warm-transfer] no conference.participants.customer on task attributes', taskSid);
      }
    } catch (holdErr) {
      console.warn('[initiate-warm-transfer] failed to hold seller', holdErr.message);
    }

    response.setBody({ success: true, callSid: participant.callSid });
    return callback(null, response);
  } catch (err) {
    console.error('[initiate-warm-transfer]', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
