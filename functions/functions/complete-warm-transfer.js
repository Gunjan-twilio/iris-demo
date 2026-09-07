const twilio = require('twilio');

// Warm transfer final step — lets Agent1 hand off for good: unholds the
// seller so they and Agent2 can talk, makes sure Agent1's own leg leaving
// won't tear down the conference, and flips the two remaining participants
// to end-on-exit so the call behaves like a normal 2-party call once it's
// down to just Agent2 + the seller. Agent1's leg itself is disconnected
// client-side (existing call.disconnect()) right after this call succeeds.
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

  const { taskSid, agentContactUri } = event;

  if (!taskSid) {
    response.setStatusCode(400);
    response.setBody({ error: 'taskSid is required' });
    return callback(null, response);
  }

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);

    const task = await client.taskrouter.v1.workspaces(context.WORKSPACE_SID).tasks(taskSid).fetch();
    const taskAttrs = JSON.parse(task.attributes || '{}');
    const conferenceSid = taskAttrs.conference?.sid || taskSid;
    const customerCallSid = taskAttrs.conference?.participants?.customer;
    let agent1CallSid = taskAttrs.conference?.participants?.worker;

    const participants = await client.conferences(conferenceSid).participants.list();

    if (!agent1CallSid && agentContactUri) {
      const calls = await Promise.all(participants.map((p) => client.calls(p.callSid).fetch()));
      const mine = calls.find((c) => c.to === agentContactUri);
      agent1CallSid = mine ? mine.sid : null;
    }

    // Bring the seller back into live audio now that the handoff is complete.
    if (customerCallSid) {
      await client.conferences(conferenceSid).participants(customerCallSid).update({ hold: false });
    } else {
      console.warn('[complete-warm-transfer] no conference.participants.customer on task attributes', taskSid);
    }

    if (agent1CallSid) {
      // Agent1's own leg is about to exit (client-side disconnect) — make
      // sure that doesn't end the conference for whoever is staying on.
      await client.conferences(conferenceSid).participants(agent1CallSid).update({ endConferenceOnExit: false });

      // Everyone else is about to become the "last two" (seller + Agent2) —
      // flip them to end-on-exit so a normal 2-party hangup ends the call
      // for both, same as any other call.
      await Promise.all(
        participants
          .filter((p) => p.callSid !== agent1CallSid)
          .map((p) => client.conferences(conferenceSid).participants(p.callSid).update({ endConferenceOnExit: true }))
      );
    } else {
      // Couldn't positively identify Agent1's own leg — leave everyone's
      // endConferenceOnExit untouched rather than risk flipping it to true
      // on the participant that's about to disconnect (which would end the
      // conference for the parties we're trying to keep connected).
      console.warn('[complete-warm-transfer] could not identify Agent1 leg; skipping endConferenceOnExit updates', taskSid);
    }

    response.setBody({ success: true });
    return callback(null, response);
  } catch (err) {
    console.error('[complete-warm-transfer]', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
