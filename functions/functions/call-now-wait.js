exports.handler = function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'text/xml');

  const twiml = new Twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'Polly.Joanna' },
    'Thank you for contacting Walmart Seller Support. Please hold while we connect you to the next available associate.'
  );
  twiml.play({ loop: 0 }, 'https://com.twilio.music.classical.s3.amazonaws.com/BusyStrings.mp3');

  response.setBody(twiml.toString());
  return callback(null, response);
};
