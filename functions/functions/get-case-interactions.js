const twilio = require('twilio');
const Airtable = require('airtable');

exports.handler = async function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Access-Control-Allow-Origin', '*');
  response.appendHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.appendHeader('Content-Type', 'application/json');

  if (event.httpMethod === 'OPTIONS') {
    response.setStatusCode(200);
    return callback(null, response);
  }

  const { case_id } = event;
  if (!case_id) {
    response.setStatusCode(400);
    response.setBody({ error: 'case_id is required' });
    return callback(null, response);
  }

  try {
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);
    const base = new Airtable({ apiKey: context.AIRTABLE_API_KEY }).base(context.AIRTABLE_BASE_ID);

    const records = await base('Cases')
      .select({
        filterByFormula: `{case_id} = '${case_id}'`,
        sort: [{ field: 'created_at', direction: 'desc' }],
      })
      .all();

    const interactions = await Promise.all(
      records.map(async (rec) => {
        const f = rec.fields;
        const interaction = {
          airtable_id: rec.id,
          case_id: f.case_id,
          channel: f.channel,
          status: f.status,
          seller_name: f.seller_name,
          seller_phone: f.seller_phone || '',
          seller_email: f.seller_email || '',
          help_category: f.help_category,
          task_sid: f.task_sid || '',
          conversation_sid: f.conversation_sid || '',
          created_at: f.created_at || '',
          messages: [],
        };

        // Fetch messages for chat and email interactions
        if (f.conversation_sid && (f.channel === 'chat' || f.channel === 'email')) {
          try {
            const paginator = await client.conversations.v1
              .services(context.CONVERSATIONS_SERVICE_SID)
              .conversations(f.conversation_sid)
              .messages.list({ limit: 200 });

            interaction.messages = paginator.map(m => ({
              sid: m.sid,
              author: m.author,
              body: m.body,
              dateCreated: m.dateCreated,
            }));
          } catch (e) {
            // Conversation may have been deleted — skip messages
          }
        }

        return interaction;
      })
    );

    response.setBody({ interactions });
    return callback(null, response);
  } catch (err) {
    console.error(err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
