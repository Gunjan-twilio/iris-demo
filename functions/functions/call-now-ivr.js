const twilio = require('twilio');

exports.handler = async function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'text/xml');

  const twiml = new Twilio.twiml.VoiceResponse();
  const digit = event.Digits;
  const caseId = event.case_id;
  const sellerName = event.seller_name || '';
  const helpCategory = event.help_category || '';

  const baseUrl = `https://${context.DOMAIN_NAME}`;
  const ivrUrl = `${baseUrl}/call-now-ivr?case_id=${encodeURIComponent(caseId)}&seller_name=${encodeURIComponent(sellerName)}&help_category=${encodeURIComponent(helpCategory)}`;

  if (!digit) {
    const gather = twiml.gather({
      numDigits: '1',
      action: ivrUrl,
      method: 'POST',
      timeout: 10,
    });
    gather.say({ voice: 'Polly.Joanna' },
      'Thank you for contacting Walmart Seller Support. Press 1 to connect to an associate.'
    );
    twiml.redirect(ivrUrl);
  } else if (digit === '1') {
    try {
      const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);
      await client.taskrouter.v1
        .workspaces(context.WORKSPACE_SID)
        .tasks.create({
          workflowSid: context.WORKFLOW_SID,
          taskChannel: 'default',
          attributes: JSON.stringify({
            channel: 'call_now',
            case_id: caseId,
            seller_name: sellerName,
            help_category: helpCategory,
            seller_phone: event.Called || event.To || '',
            conference_name: caseId,
          }),
        });
    } catch (err) {
      console.error('[call-now-ivr] TaskRouter create failed:', err.message);
    }

    twiml.redirect(`${baseUrl}/call-now-hold?conference_name=${encodeURIComponent(caseId)}`);
  } else {
    twiml.say({ voice: 'Polly.Joanna' }, 'Sorry, that is not a valid option.');
    twiml.redirect(ivrUrl);
  }

  response.setBody(twiml.toString());
  return callback(null, response);
};
