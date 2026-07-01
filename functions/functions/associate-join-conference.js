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

  const { conference_name, associate_identity } = event;

  if (!conference_name || !associate_identity) {
    response.setStatusCode(400);
    response.setBody({ error: 'conference_name and associate_identity are required' });
    return callback(null, response);
  }

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);

    const conferenceUrl =
      `https://${context.DOMAIN_NAME}/call-now-conference` +
      `?conference_name=${encodeURIComponent(conference_name)}`;

    const call = await client.calls.create({
      to: `client:${associate_identity}`,
      from: context.TWILIO_PHONE_NUMBER,
      url: conferenceUrl,
      method: 'GET',
    });

    response.setBody({ success: true, call_sid: call.sid });
    return callback(null, response);
  } catch (err) {
    console.error('[associate-join-conference]', err.message);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
