// Served as the Conference resource's announceUrl (see
// announceOnSellerConnect in accept-reservation.js) — this plays to the
// whole conference, so both the seller and the associate hear it. The
// associate is muted for the duration (also set up in
// announceOnSellerConnect) so their live voice doesn't bleed into the mix.
//
// conference_sid/associate_call_sid, when present, are forwarded unchanged
// to call-now-announcement-done.js via a trailing <Redirect> — the TwiML
// context for an announceUrl response may only contain Say/Play/Pause/
// Redirect verbs, so Redirect is what stands in for a true "announcement
// finished" signal here: Twilio only requests it once the Play/Say above has
// actually finished playing, not on a guessed timer.
exports.handler = function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'text/xml');

  const { conference_sid, associate_call_sid } = event;
  const twiml = new Twilio.twiml.VoiceResponse();
  //twiml.say({ voice: 'Polly.Joanna' }, 'Hello, Your call is being recorded for quality and training purposes. Please stay on the line while we connect you to an associate.');
  twiml.play({ loop: 1 }, `https://${context.DOMAIN_NAME}/announcement.mp3`);

  if (conference_sid && associate_call_sid) {
    const doneUrl = `https://${context.DOMAIN_NAME}/call-now-announcement-done` +
      `?conference_sid=${encodeURIComponent(conference_sid)}` +
      `&associate_call_sid=${encodeURIComponent(associate_call_sid)}`;
    twiml.redirect({ method: 'GET' }, doneUrl);
  }

  response.setBody(twiml.toString());
  return callback(null, response);
};
