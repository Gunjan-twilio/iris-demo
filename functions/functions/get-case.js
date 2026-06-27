const Airtable = require('airtable');

exports.handler = async function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Access-Control-Allow-Origin', '*');
  response.appendHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.appendHeader('Content-Type', 'application/json');

  const { case_id } = event;

  if (!case_id) {
    response.setStatusCode(400);
    response.setBody({ error: 'case_id is required' });
    return callback(null, response);
  }

  try {
    const base = new Airtable({ apiKey: context.AIRTABLE_API_KEY }).base(context.AIRTABLE_BASE_ID);
    const records = await base('Cases').select({ filterByFormula: `{case_id} = '${case_id}'` }).firstPage();

    if (records.length === 0) {
      response.setStatusCode(404);
      response.setBody({ error: 'Case not found' });
      return callback(null, response);
    }

    const record = records[0].fields;
    response.setBody({
      case_id: record.case_id,
      status: record.status,
      conversation_sid: record.conversation_sid || null,
      channel: record.channel,
      case_summary: record.case_summary || '',
      seller_email: record.seller_email || '',
      seller_phone: record.seller_phone || '',
      seller_name: record.seller_name || '',
    });

    return callback(null, response);
  } catch (err) {
    console.error(err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
