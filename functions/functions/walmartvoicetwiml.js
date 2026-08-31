exports.handler = function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'text/xml');

  const twiml = new Twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'Polly.Joanna' }, 'Hello, welcome to Walmart voice demo thank you');

  response.setBody(twiml.toString());
  return callback(null, response);
};
