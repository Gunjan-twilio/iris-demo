const Airtable = require('airtable');

exports.handler = async function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'application/json');

  try {
    const taskAttrs = JSON.parse(event.TaskAttributes || '{}');

    // Store the pending reservation in Airtable so the browser can poll for it
    const base = new Airtable({ apiKey: context.AIRTABLE_API_KEY }).base(context.AIRTABLE_BASE_ID);

    // Update the matching case with the reservation SID
    if (taskAttrs.case_id) {
      const records = await base('Cases')
        .select({ filterByFormula: `{case_id} = '${taskAttrs.case_id}'` })
        .firstPage();

      if (records.length > 0) {
        await base('Cases').update(records[0].id, {
          task_sid: event.TaskSid,
          reservation_sid: event.ReservationSid,
          status: 'new',
        });
      }
    }

    // Tell TaskRouter to accept — UI handles the actual workflow from here
    response.setBody({ instruction: 'accept' });
    return callback(null, response);
  } catch (err) {
    console.error(err);
    response.setBody({ instruction: 'reject' });
    return callback(null, response);
  }
};
