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
    const records = await base('Cases')
      .select({
        sort: [{ field: 'case_id', direction: 'desc' }],
        maxRecords: 50,
      })
      .all();

    const cases = records.map(r => ({
      case_id: r.fields.case_id || '',
      status: r.fields.status || '',
      channel: r.fields.channel || '',
      case_summary: r.fields.case_summary || '',
      help_category: r.fields.help_category || '',
      seller_name: r.fields.seller_name || '',
      seller_email: r.fields.seller_email || '',
      seller_phone: r.fields.seller_phone || '',
      conversation_sid: r.fields.conversation_sid || '',
      task_sid: r.fields.task_sid || '',
      updated_at: r.fields.updated_at || r.fields.created_at || '',
    }));

    response.setBody({ cases });
    return callback(null, response);
  } catch (err) {
    console.error(err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
