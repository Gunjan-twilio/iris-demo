const twilio = require('twilio');
const Airtable = require('airtable');

const STUDIO_FLOW_SID = 'FWe006e2c7a05b89dd260d4d7f2e90c7c7';

exports.handler = async function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Access-Control-Allow-Origin', '*');
  response.appendHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.appendHeader('Content-Type', 'application/json');

  if (event.httpMethod === 'OPTIONS') {
    response.setStatusCode(200);
    return callback(null, response);
  }

  const { seller_name, seller_email, help_category, case_summary } = event;

  if (!seller_name || !seller_email || !help_category) {
    response.setStatusCode(400);
    response.setBody({ error: 'seller_name, seller_email, and help_category are required' });
    return callback(null, response);
  }

  const case_id = `CASE-${Date.now()}`;

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);
    const base = new Airtable({ apiKey: context.AIRTABLE_API_KEY }).base(context.AIRTABLE_BASE_ID);

    // 1. Create a Conversation in the Flex service
    const conversation = await client.conversations.v1
      .services(context.CONVERSATIONS_SERVICE_SID)
      .conversations.create({
        friendlyName: case_id,
        attributes: JSON.stringify({
          case_id,
          seller_name,
          seller_email: seller_email.toLowerCase().trim(),
          help_category,
          case_summary: case_summary || '',
          channel: 'chat',
        }),
      });

    const conversation_sid = conversation.sid;

    // 2. Add the seller as a participant
    await client.conversations.v1
      .services(context.CONVERSATIONS_SERVICE_SID)
      .conversations(conversation_sid)
      .participants.create({ identity: seller_email.toLowerCase().trim() });

    // 3. Attach Studio flow — fires on seller's first message to route to Flex
    await client.conversations.v1
      .services(context.CONVERSATIONS_SERVICE_SID)
      .conversations(conversation_sid)
      .webhooks.create({
        target: 'studio',
        'configuration.flowSid': STUDIO_FLOW_SID,
      });

    // 4. Write Airtable case record
    await base('Cases').create({
      case_id,
      seller_name,
      seller_email: seller_email.toLowerCase().trim(),
      help_category,
      channel: 'chat',
      status: 'new',
      case_summary: case_summary || '',
      conversation_sid,
      created_at: new Date().toISOString().split('T')[0],
    });

    response.setBody({ case_id, conversation_sid });
    return callback(null, response);

  } catch (err) {
    console.error('create-webchat-interaction error:', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
