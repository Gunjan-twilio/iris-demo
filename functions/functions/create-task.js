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

  if (channel === 'email' && !seller_email) {
    response.setStatusCode(400);
    response.setBody({ error: 'seller_email is required for email channel' });
    return callback(null, response);
  }

  const case_id = `CASE-${Date.now()}`;
  const emailSubject = `[${case_id}] ${case_summary || case_id}`;

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);
    const base = new Airtable({ apiKey: context.AIRTABLE_API_KEY }).base(context.AIRTABLE_BASE_ID);

    let conversation_sid = null;

    if (channel === 'email') {
      // Use Flex Interactions API — sets subject, proxy_address, creates conversation + task
      // Must use form-encoded POST (SDK sends JSON which the endpoint rejects)
      const https = require('https');
      const qs = require('querystring');

      const channelParam = JSON.stringify({
        type: 'email',
        initiated_by: 'api',
        properties: {
          from: context.EMAIL_ADDRESS,
          from_name: 'Retail Support',
          subject: emailSubject,
        },
        participants: [{ address: seller_email, level: 'to', name: seller_name }],
      });

      const routingParam = JSON.stringify({
        properties: {
          workspace_sid: context.WORKSPACE_SID,
          workflow_sid: context.WORKFLOW_SID,
          task_channel_unique_name: 'default',
          attributes: {
            skill: help_category,
            channel,
            seller_name,
            seller_phone: seller_phone || '',
            seller_email,
            case_summary: case_summary || '',
            case_id,
          },
        },
      });

      const postData = qs.stringify({ Channel: channelParam, Routing: routingParam });
      const auth = Buffer.from(`${context.ACCOUNT_SID}:${context.AUTH_TOKEN}`).toString('base64');

      const interaction = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'flex-api.twilio.com',
          path: '/v1/Interactions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${auth}`,
            'Content-Length': Buffer.byteLength(postData),
          },
        }, res => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) reject(new Error(parsed.message || JSON.stringify(parsed)));
            else resolve(parsed);
          });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
      });

      // conversationSid is in the task attributes returned by the Interactions API
      const taskAttrs = JSON.parse(interaction.routing.properties.attributes || '{}');
      const conversation_sid_from_interaction = taskAttrs.conversationSid || '';

      await base('Cases').create({
        case_id,
        seller_name,
        help_category,
        channel,
        status: 'new',
        seller_phone: seller_phone || '',
        seller_email,
        case_summary: case_summary || '',
        conversation_sid: conversation_sid_from_interaction,
        created_at: new Date().toISOString().split('T')[0],
      });

    } else {
      // Chat and phone: create TaskRouter task directly
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
            conversation_sid: '',
          }),
        });

      await base('Cases').create({
        case_id,
        seller_name,
        help_category,
        channel,
        status: 'new',
        seller_phone: seller_phone || '',
        seller_email: seller_email || '',
        case_summary: case_summary || '',
        conversation_sid: '',
        created_at: new Date().toISOString().split('T')[0],
      });
    }

    response.setBody({ case_id });
    return callback(null, response);
  } catch (err) {
    console.error(err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
