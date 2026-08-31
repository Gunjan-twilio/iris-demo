exports.handler = function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'text/xml');

  const twiml = new Twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'Polly.Joanna' }, 'Hello, Your call is being recorded for quality and training purposes. Please stay on the line while we connect you to an associate.');

  response.setBody(twiml.toString());
  return callback(null, response);
};
