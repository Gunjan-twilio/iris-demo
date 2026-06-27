const Airtable = require('airtable');
const Handlebars = require('handlebars');

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

  const { template_id, case_id, seller_name, case_summary, help_category, seller_email } = event;

  if (!template_id) {
    response.setStatusCode(400);
    response.setBody({ error: 'template_id is required' });
    return callback(null, response);
  }

  try {
    const base = new Airtable({ apiKey: context.AIRTABLE_API_KEY }).base(context.AIRTABLE_BASE_ID);
    const record = await base('Templates').find(template_id);

    const html_content = record.fields.html_content || '';

    const data = {
      case_id: case_id || '',
      seller_name: seller_name || '',
      case_summary: case_summary || '',
      help_category: help_category || '',
      seller_email: seller_email || '',
    };

    const html = Handlebars.compile(html_content)(data);

    response.setBody({ html });
    return callback(null, response);
  } catch (err) {
    console.error(err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
    return callback(null, response);
  }
};
