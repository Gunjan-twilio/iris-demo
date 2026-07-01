exports.handler = function (context, event, callback) {
  const twiml = new Twilio.twiml.VoiceResponse();

  const toParam = event.To || '';
  const isConference = toParam.startsWith('CASE-');

  if (isConference) {
    // Call Now: To param is the case_id/conference_name — join the named conference
    const dial = twiml.dial();
    dial.conference(toParam, {
      startConferenceOnEnter: 'true',
      endConferenceOnExit: 'true',
      muted: 'false',
      beep: 'false',
    });
  } else if (event.seller_phone) {
    // Phone callback: dial the seller's real phone
    const dial = twiml.dial({ callerId: context.TWILIO_PHONE_NUMBER });
    dial.number(event.seller_phone);
  } else {
    twiml.say('Call setup failed.');
  }

  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'text/xml');
  response.setBody(twiml.toString());

  return callback(null, response);
};
