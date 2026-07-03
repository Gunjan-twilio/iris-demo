const twilio = require('twilio');

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

  const { conversation_sid, body, subject, author } = event;

  if (!conversation_sid || !body) {
    response.setStatusCode(400);
    response.setBody({ error: 'conversation_sid and body are required' });
    return callback(null, response);
  }

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);

    const msg = await client.conversations.v1
      .services(context.CONVERSATIONS_SERVICE_SID)
      .conversations(conversation_sid)
      .messages.create({
        author: author || 'associate',
        body,
        attributes: JSON.stringify({ subject: subject || '' }),
      });

    response.setBody({ sid: msg.sid });
    return callback(null, response);
  } catch (err) {
    console.error(err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
