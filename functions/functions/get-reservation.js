const Airtable = require('airtable');

exports.handler = async function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Access-Control-Allow-Origin', '*');
  response.appendHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.appendHeader('Content-Type', 'application/json');

  try {
    const base = new Airtable({ apiKey: context.AIRTABLE_API_KEY }).base(context.AIRTABLE_BASE_ID);

    // Find a case that has a reservation_sid and is still awaiting associate action
    const records = await base('Cases')
      .select({
        filterByFormula: `AND({status} = 'new', {reservation_sid} != '')`,
        maxRecords: 1,
        sort: [{ field: 'created_at', direction: 'desc' }],
      })
      .firstPage();

    if (records.length === 0) {
      response.setBody({ reservation_sid: null });
      return callback(null, response);
    }

    const fields = records[0].fields;
    response.setBody({
      reservation_sid: fields.reservation_sid,
      task_sid: fields.task_sid,
      task_attrs: {
        seller_name: fields.seller_name,
        skill: fields.help_category,
        help_category: fields.help_category,
        channel: fields.channel,
        case_id: fields.case_id,
        seller_phone: fields.seller_phone || '',
        seller_email: fields.seller_email || '',
        conversation_sid: fields.conversation_sid || '',
      },
    });

    return callback(null, response);
  } catch (err) {
    console.error(err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
