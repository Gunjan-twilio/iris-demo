exports.handler = function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'text/xml');

  const conferenceName = event.conference_name || event.ConferenceName || '';
  const twiml = new Twilio.twiml.VoiceResponse();

  const dial = twiml.dial();
  dial.conference(conferenceName, {
    startConferenceOnEnter: 'true',
    endConferenceOnExit: 'true',
    muted: 'false',
    beep: 'false',
    record: 'do-not-record',
  });

  response.setBody(twiml.toString());
  return callback(null, response);
};
