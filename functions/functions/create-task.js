const twilio = require('twilio');
const Airtable = require('airtable');

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

  const { seller_name, help_category, channel, seller_phone, seller_email, case_summary } = event;

  if (!seller_name || !help_category || !channel) {
    response.setStatusCode(400);
    response.setBody({ error: 'seller_name, help_category and channel are required' });
    return callback(null, response);
  }

  const case_id = `CASE-${Date.now()}`;

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);

    // For email: create a Flex Conversation with an email participant
    // Flex will receive inbound replies from the seller and route them into this conversation
    let conversation_sid = null;
    if (channel === 'email') {
      if (!seller_email) {
        response.setStatusCode(400);
        response.setBody({ error: 'seller_email is required for email channel' });
        return callback(null, response);
      }

      // Create conversation with email binding — generates a unique projected_address for threading
      const conversation = await client.conversations.v1
        .services(context.CONVERSATIONS_SERVICE_SID)
        .conversations.create({
          friendlyName: case_id,
          attributes: JSON.stringify({ case_id }),
          'bindings.email.address': context.EMAIL_ADDRESS,
        });

      conversation_sid = conversation.sid;

      // Add associate as identity participant
      await client.conversations.v1
        .services(context.CONVERSATIONS_SERVICE_SID)
        .conversations(conversation_sid)
        .participants.create({ identity: 'associate1' });

      // Add seller as email participant (type=email, address=their inbox)
      await client.conversations.v1
        .services(context.CONVERSATIONS_SERVICE_SID)
        .conversations(conversation_sid)
        .participants.create({
          'messagingBinding.address': seller_email,
          'messagingBinding.type': 'email',
        });
    }

    await client.taskrouter.v1
      .workspaces(context.WORKSPACE_SID)
      .tasks.create({
        workflowSid: context.WORKFLOW_SID,
        taskChannel: 'default',
        attributes: JSON.stringify({
          skill: help_category,
          channel,
          seller_name,
          seller_phone: seller_phone || '',
          seller_email: seller_email || '',
          case_summary: case_summary || '',
          case_id,
          conversation_sid: conversation_sid || '',
        }),
      });

    const base = new Airtable({ apiKey: context.AIRTABLE_API_KEY }).base(context.AIRTABLE_BASE_ID);
    await base('Cases').create({
      case_id,
      seller_name,
      help_category,
      channel,
      status: 'new',
      seller_phone: seller_phone || '',
      seller_email: seller_email || '',
      case_summary: case_summary || '',
      conversation_sid: conversation_sid || '',
      created_at: new Date().toISOString().split('T')[0],
    });

    response.setBody({ case_id });
    return callback(null, response);
  } catch (err) {
    console.error(err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
