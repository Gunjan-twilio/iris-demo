// TwiML endpoint used two ways: (1) legacy/disabled — a warm-transfer
// consult task's `call` instruction (AssociatePanel.jsx's isWarmConsult
// branch, not currently reachable since no task sets isWarmConsult anymore);
// (2) current — complete-warm-consult.js REST-redirects the seller's own
// live call leg here to join Conference 2 (`event.taskSid` = Task 2's SID,
// the Twilio-assigned conference name), turning it into {Agent 2, Seller}.
// endConferenceOnExit:true so this leg leaving (the seller hanging up) tears
// down Conference 2 for Agent 2 too, matching how a plain call_now
// conference ends when either party leaves.
exports.handler = function (context, event, callback) {
  const twiml = new Twilio.twiml.VoiceResponse();
  const dial = twiml.dial();
  dial.conference({ endConferenceOnExit: true }, event.taskSid);

  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'text/xml');
  response.setBody(twiml.toString());
  return callback(null, response);
};
