exports.handler = function (context, event, callback) {
  const twiml = new Twilio.twiml.VoiceResponse();

  if (event.seller_phone) {
    // Associate's browser answered — now dial the seller's real phone
    const dial = twiml.dial({ callerId: context.TWILIO_PHONE_NUMBER });
    dial.number(event.seller_phone);
  } else {
    twiml.say('Call setup failed. No seller phone number provided.');
  }

  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'text/xml');
  response.setBody(twiml.toString());

  return callback(null, response);
};
