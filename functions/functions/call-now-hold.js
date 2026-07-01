exports.handler = function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'text/xml');

  const conferenceName = event.conference_name || '';
  const twiml = new Twilio.twiml.VoiceResponse();

  twiml.say({ voice: 'Polly.Joanna' },
    'Please hold while we connect you to the next available Walmart Seller Support associate.'
  );

  const dial = twiml.dial();
  dial.conference(conferenceName, {
    startConferenceOnEnter: 'false',
    endConferenceOnExit: 'true',
    waitUrl: 'https://twimlets.com/holdmusic?Bucket=com.twilio.music.classical',
    waitMethod: 'GET',
    muted: 'false',
    beep: 'false',
    record: 'do-not-record',
  });

  response.setBody(twiml.toString());
  return callback(null, response);
};
