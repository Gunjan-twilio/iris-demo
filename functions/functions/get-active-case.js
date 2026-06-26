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

  try {
    const base = new Airtable({ apiKey: context.AIRTABLE_API_KEY }).base(context.AIRTABLE_BASE_ID);

    // Find the most recent wip case assigned to the associate
    const records = await base('Cases')
      .select({
        filterByFormula: `AND({status}='wip', {assigned_worker}='Associate-1')`,
        sort: [{ field: 'created_at', direction: 'desc' }],
        maxRecords: 1,
      })
      .firstPage();

    if (records.length === 0) {
      response.setBody({ case: null });
      return callback(null, response);
    }

    const f = records[0].fields;
    response.setBody({
      case: {
        case_id: f.case_id,
        channel: f.channel,
        seller_name: f.seller_name,
        seller_email: f.seller_email || '',
        seller_phone: f.seller_phone || '',
        help_category: f.help_category,
        case_summary: f.case_summary || '',
        conversation_sid: f.conversation_sid || '',
        task_sid: f.task_sid || '',
      }
    });
    return callback(null, response);
  } catch (err) {
    console.error(err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
