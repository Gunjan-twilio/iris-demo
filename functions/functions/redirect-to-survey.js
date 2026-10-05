const twilio = require('twilio');

// Redirects the customer's live call leg into the post-call survey flow by
// updating it with an inline TwiML <Redirect> to survey.js. Mirrors how
// transfer-cold.js resolves the customer call leg off the task, but instead
// of parking it in a new queue, this hands it off to the survey endpoint —
// typically called once the associate leg has ended.
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
    const customerCallSid = attrs.conference?.participants?.customer || attrs.call_sid;

    if (!customerCallSid) {
      response.setStatusCode(400);
      response.setBody({ error: 'Task has no associated customer call to redirect' });
      return callback(null, response);
    }

    const surveyUrl =
      `https://${context.DOMAIN_NAME}/survey?taskSid=${encodeURIComponent(taskSid)}`;

    const twiml = new Twilio.twiml.VoiceResponse();
    twiml.redirect({ method: 'GET' }, surveyUrl);

    await client.calls(customerCallSid).update({ twiml: twiml.toString() });

    response.setBody({ success: true });
    return callback(null, response);
  } catch (err) {
    console.error('[redirect-to-survey]', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
