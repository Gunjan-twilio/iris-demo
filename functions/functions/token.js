const twilio = require('twilio');

exports.handler = function (context, event, callback) {
  const {
    ACCOUNT_SID,
    API_KEY_SID,
    API_KEY_SECRET,
    WORKSPACE_SID,
    WORKER_SID,
    TWIML_APP_SID,
    CONVERSATIONS_SERVICE_SID,
  } = context;

  const identity = event.identity || 'associate1';

  const AccessToken = twilio.jwt.AccessToken;
  const token = new AccessToken(ACCOUNT_SID, API_KEY_SID, API_KEY_SECRET, {
    identity,
    ttl: 3600,
  });

  const TaskRouterGrant = AccessToken.TaskRouterGrant;
  token.addGrant(new TaskRouterGrant({
    workspaceSid: WORKSPACE_SID,
    workerSid: WORKER_SID,
    role: 'worker',
  }));

  const ConversationsGrant = AccessToken.ChatGrant;
  token.addGrant(new ConversationsGrant({
    serviceSid: CONVERSATIONS_SERVICE_SID,
  }));

  const VoiceGrant = AccessToken.VoiceGrant;
  token.addGrant(new VoiceGrant({
    outgoingApplicationSid: TWIML_APP_SID,
    incomingAllow: true,
  }));

  const response = new Twilio.Response();
  response.appendHeader('Access-Control-Allow-Origin', '*');
  response.appendHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.appendHeader('Content-Type', 'application/json');
  response.setBody({ token: token.toJwt(), identity });

  return callback(null, response);
};
