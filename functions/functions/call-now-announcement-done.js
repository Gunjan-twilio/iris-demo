const twilio = require('twilio');

// Reached via the <Redirect> at the end of call-now-connect-say.js's TwiML
// — Twilio only requests that redirect once the Say/Play audio has actually
// finished playing to the seller (the announceUrl target), so this fires on
// a genuine "announcement done" signal, not a timer.
//
// Unmutes the associate's leg that accept-reservation.js muted right before
// starting the seller's announcement (see announceOnSellerConnect's header
// comment for why: announceUrl layers its audio on top of the seller's
// existing conference mix rather than replacing it, so without muting the
// associate, the seller would hear the associate's live voice mixed in
// under the greeting). Best-effort webhook — any failure here must not drop
// the call; worst case the associate stays muted and can unmute themselves
// via the UI's Mute button (PhoneControls.jsx), which is a separate,
// client-side local-mic mute unaffected by this.
exports.handler = async function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'text/xml');

  const { conference_sid, associate_call_sid } = event;
  const twiml = new Twilio.twiml.VoiceResponse();

  try {
    if (conference_sid && associate_call_sid) {
      const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);
      await client.conferences(conference_sid).participants(associate_call_sid).update({ muted: false });
    }
  } catch (err) {
    console.warn('[call-now announce] failed to unmute associate', err.message);
  }

  response.setBody(twiml.toString());
  return callback(null, response);
};
