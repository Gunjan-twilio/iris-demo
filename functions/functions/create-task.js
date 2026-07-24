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
  const emailSubject = `[${case_id}] ${case_summary || case_id}`;

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);
    const base = new Airtable({ apiKey: context.AIRTABLE_API_KEY }).base(context.AIRTABLE_BASE_ID);
    let conversation_sid = null;

    if (channel === 'chat') {
      await client.taskrouter.v1
        .workspaces(context.WORKSPACE_SID)
        .tasks.create({
          workflowSid: context.WORKFLOW_SID,
          taskChannel: 'chat',
          attributes: JSON.stringify({
            skill: help_category, channel, seller_name,
            seller_phone: seller_phone || '', seller_email: (seller_email || '').toLowerCase().trim(),
            case_summary: case_summary || '', case_id,
            conversationSid: '',
          }),
        });

    } else if (channel === 'email') {
      const interaction = await client.flexApi.v1.interaction.create({
        channel: {
          type: 'email',
          initiated_by: 'api',
          properties: { from: context.EMAIL_ADDRESS, from_name: 'Retail Support', subject: emailSubject },
          participants: [{ address: seller_email, level: 'to', name: seller_name }],
        },
        routing: {
          properties: {
            workspace_sid: context.WORKSPACE_SID,
            workflow_sid: context.WORKFLOW_SID,
            task_channel_unique_name: 'email',
            attributes: {
              skill: help_category, channel, seller_name,
              seller_phone: seller_phone || '', seller_email,
              case_summary: case_summary || '', case_id,
            },
          },
        },
      });

      const taskAttrs = JSON.parse(interaction.routing?.properties?.attributes || '{}');
      conversation_sid = taskAttrs.conversationSid || '';

    } else if (channel === 'email_hybrid') {
      // Same shape as OOTB `email` (Flex Interactions API creates the task and
      // Conversation with email participants and ChannelMetadata tracking) —
      // but attributes.channel is `email_hybrid` so the frontend runs the
      // participants-dance outbound flow via SendGrid instead of Twilio's
      // built-in email dispatch. Inbound is still handled by Twilio's
      // projected_address ingestion.
      const interaction = await client.flexApi.v1.interaction.create({
        channel: {
          type: 'email',
          initiated_by: 'api',
          properties: { from: context.EMAIL_ADDRESS, from_name: 'Retail Support', subject: emailSubject },
          participants: [{ address: seller_email, level: 'to', name: seller_name }],
        },
        routing: {
          properties: {
            workspace_sid: context.WORKSPACE_SID,
            workflow_sid: context.WORKFLOW_SID,
            task_channel_unique_name: 'email',
            attributes: {
              skill: help_category, channel, seller_name,
              seller_phone: seller_phone || '', seller_email,
              case_summary: case_summary || '', case_id,
            },
          },
        },
      });

      const taskAttrs = JSON.parse(interaction.routing?.properties?.attributes || '{}');
      conversation_sid = taskAttrs.conversationSid || '';

      // Attach a scoped onMessageAdded webhook so persist-email-participants
      // caches to/cc + ChannelMetadata as inbound and outbound messages arrive.
      if (conversation_sid) {
        try {
          await client.conversations.v1
            .services(context.CONVERSATIONS_SERVICE_SID)
            .conversations(conversation_sid)
            .webhooks.create({
              target: 'webhook',
              'configuration.filters': ['onMessageAdded'],
              'configuration.method': 'POST',
              'configuration.url': `https://${context.DOMAIN_NAME}/persist-email-participants`,
            });
        } catch (err) {
          console.warn('[create-task email_hybrid] scoped webhook attach failed', err.message);
        }
      }

    } else if (channel === 'email_forwarded') {
      // Walmart architecture (PDF pages 5–6): outbound send via SendGrid API as
      // support@walmart.com; inbound seller replies land at SendGrid Inbound
      // Parse (fly.io receiver) which relays to inbound-parse-relay.js and
      // appends to the same Conversation.
      const normalizedEmail = (seller_email || '').toLowerCase().trim();
      const conversation = await client.conversations.v1
        .services(context.CONVERSATIONS_SERVICE_SID)
        .conversations.create({
          friendlyName: `${case_id} — ${normalizedEmail}`,
          attributes: JSON.stringify({
            channelType: 'email_forwarded',
            customerEmail: normalizedEmail,
            caseId: case_id,
            subject: emailSubject,
          }),
        });
      conversation_sid = conversation.sid;

      // Add seller as a chat participant so their portal SDK receives messages.
      await client.conversations.v1
        .services(context.CONVERSATIONS_SERVICE_SID)
        .conversations(conversation_sid)
        .participants.create({ identity: normalizedEmail });

      // Scoped onMessageAdded webhook: fires ONLY for this conversation, so
      // outbound-email-forwarded stays isolated from chat / OOTB email traffic.
      // Pattern from leroychan/twilio-flex-conversations-adapters.
      await client.conversations.v1
        .services(context.CONVERSATIONS_SERVICE_SID)
        .conversations(conversation_sid)
        .webhooks.create({
          target: 'webhook',
          'configuration.filters': ['onMessageAdded'],
          'configuration.method': 'POST',
          'configuration.url': `https://${context.DOMAIN_NAME}/outbound-email-forwarded`,
        });

      await client.taskrouter.v1
        .workspaces(context.WORKSPACE_SID)
        .tasks.create({
          workflowSid: context.WORKFLOW_SID,
          taskChannel: 'default',
          attributes: JSON.stringify({
            skill: help_category, channel, seller_name,
            seller_phone: seller_phone || '', seller_email: normalizedEmail,
            case_summary: case_summary || '', case_id,
            conversationSid: conversation_sid,
            subject: emailSubject,
          }),
        });

    } else if (channel === 'call_now') {
      // Call Now: immediately dial seller → IVR creates the TaskRouter task after press-1
      if (!seller_phone) {
        response.setStatusCode(400);
        response.setBody({ error: 'seller_phone is required for call_now channel' });
        return callback(null, response);
      }
      const ivrUrl =
        `https://${context.DOMAIN_NAME}/call-now-ivr` +
        `?case_id=${encodeURIComponent(case_id)}` +
        `&seller_name=${encodeURIComponent(seller_name)}` +
        `&help_category=${encodeURIComponent(help_category)}`;
      await client.calls.create({
        to: seller_phone,
        from: context.TWILIO_PHONE_NUMBER,
        url: ivrUrl,
        method: 'GET',
      });

    } else if (channel === 'callback') {
      // Callback-task pattern: create outbound TaskRouter task directly, no upfront dial.
      // Associate accepts via AcceptTask → Flex conference dials associate, then dials seller.
      if (!seller_phone) {
        response.setStatusCode(400);
        response.setBody({ error: 'seller_phone is required for callback channel' });
        return callback(null, response);
      }
      await client.taskrouter.v1
        .workspaces(context.WORKSPACE_SID)
        .tasks.create({
          workflowSid: context.WORKFLOW_SID,
          taskChannel: 'voice',
          routingTarget: context.WORKFLOW_SID,
          attributes: JSON.stringify({
            outbound_to: seller_phone,
            from: context.TWILIO_PHONE_NUMBER,
            direction: 'outbound',
            isCallback: true,
            name: `Callback: ${seller_phone}`,
            skill: help_category,
            channel: 'call_now',
            seller_name,
            seller_phone,
            seller_email: seller_email || '',
            case_summary: case_summary || '',
            case_id,
          }),
        });

    } else {
      // Phone callback: placeholder task on default channel — keeps audio pipeline unblocked
      await client.taskrouter.v1
        .workspaces(context.WORKSPACE_SID)
        .tasks.create({
          workflowSid: context.WORKFLOW_SID,
          taskChannel: 'default',
          attributes: JSON.stringify({
            skill: help_category, channel, seller_name,
            seller_phone: seller_phone || '', seller_email: seller_email || '',
            case_summary: case_summary || '', case_id, conversation_sid: '',
          }),
        });
    }

    const airtableChannel = channel === 'callback' ? 'call_now' : channel;
    await base('Cases').create({
      case_id, seller_name, help_category, channel: airtableChannel, status: 'new',
      seller_phone: seller_phone || '', seller_email: seller_email || '',
      case_summary: case_summary || '', conversation_sid: conversation_sid || '',
      created_at: new Date().toISOString().split('T')[0],
    });

    response.setBody({ case_id, conversation_sid: conversation_sid || '' });
    return callback(null, response);

  } catch (err) {
    console.error(err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
