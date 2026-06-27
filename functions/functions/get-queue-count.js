const twilio = require('twilio');

exports.handler = async function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Access-Control-Allow-Origin', '*');
  response.appendHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.appendHeader('Content-Type', 'application/json');

  if (event.httpMethod === 'OPTIONS') {
    response.setStatusCode(200);
    return callback(null, response);
  }

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);
    const tasks = await client.taskrouter.v1
      .workspaces(context.WORKSPACE_SID)
      .tasks.list({ assignmentStatus: 'pending', limit: 100 });

    response.setBody({ count: tasks.length });
    return callback(null, response);
  } catch (err) {
    console.error(err);
    response.setBody({ count: 0 });
    return callback(null, response);
  }
};
