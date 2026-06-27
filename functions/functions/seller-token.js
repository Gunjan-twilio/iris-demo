const twilio = require('twilio');

exports.handler = function (context, event, callback) {
  const identity = event.identity;
  if (!identity) {
    const r = new Twilio.Response();
    r.appendHeader('Access-Control-Allow-Origin', '*');
    r.appendHeader('Content-Type', 'application/json');
    r.setStatusCode(400);
    r.setBody({ error: 'identity required' });
    return callback(null, r);
  }

  const AccessToken = twilio.jwt.AccessToken;
  const token = new AccessToken(
    context.ACCOUNT_SID,
    context.API_KEY_SID,
    context.API_KEY_SECRET,
    { identity, ttl: 3600 }
  );

  token.addGrant(new AccessToken.ChatGrant({
    serviceSid: context.CONVERSATIONS_SERVICE_SID,
  }));

  const response = new Twilio.Response();
  response.appendHeader('Access-Control-Allow-Origin', '*');
  response.appendHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.appendHeader('Content-Type', 'application/json');
  response.setBody({ token: token.toJwt(), identity });

  return callback(null, response);
};
