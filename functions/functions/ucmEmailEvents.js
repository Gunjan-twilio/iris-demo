const crypto = require('crypto');
const https = require('https');

const certificate =
  Runtime.getAssets()['/walmart-key.private.pem'].open();
const API_HOST =
  'developer.api.us.walmart.com';

const API_PATH =
  '/api-proxy/service/case/event-pipeline/v1/webhooks/twilio';

const API_URL =
  `https://${API_HOST}${API_PATH}`;
const FALLBACK_CONSUMER_ID =
  'd87c7d31-e0dd-4ace-ab84-a8cb3c7782f5';

const FALLBACK_KEY_VERSION =
  '2';
function canonicalize(headersToSign) {

  const sortedKeys =
    Object.keys(headersToSign).sort();

  const canonicalString =
    sortedKeys
      .map(k => headersToSign[k].trim())
      .join('\n') + '\n';

  return {
    canonicalString
  };
}


function generateSignature(
  pemKey,
  stringToSign
) {

  const sign =
    crypto.createSign('SHA256');

  sign.update(
    stringToSign,
    'utf8'
  );

  return sign.sign(
    pemKey,
    'base64'
  );
}


function buildAuthHeaders(
  consumerId,
  pemKey,
  keyVersion
) {

  const timestamp =
    Date.now().toString();

  const headersToSign = {

    'WM_CONSUMER.ID':
      consumerId,

    'WM_CONSUMER.INTIMESTAMP':
      timestamp,

    'WM_SEC.KEY_VERSION':
      keyVersion
  };

  const {
    canonicalString
  } =
    canonicalize(headersToSign);

  const signature =
    generateSignature(
      pemKey,
      canonicalString
    );

  return {

    'WM_CONSUMER.ID':
      consumerId,

    'WM_CONSUMER.INTIMESTAMP':
      timestamp,

    'WM_SEC.AUTH_SIGNATURE':
      signature,

    'WM_SEC.KEY_VERSION':
      keyVersion
  };
}


// ────────────────────────────────────────────────────────────────
// HTTP helper
// ────────────────────────────────────────────────────────────────

function httpsPost(
  url,
  headers,
  body
) {

  return new Promise(
    (resolve, reject) => {

      const bodyStr =
        JSON.stringify(body);

      const parsed =
        new URL(url);

      const options = {

        hostname:
          parsed.hostname,

        path:
          parsed.pathname,

        method:
          'POST',

        headers: {

          ...headers,

          'Content-Type':
            'application/json',

          'Content-Length':
            Buffer.byteLength(bodyStr)
        }
      };

      const req =
        https.request(
          options,
          (res) => {

            const chunks = [];

            res.on(
              'data',
              chunk => chunks.push(chunk)
            );

            res.on(
              'end',
              () => {

                const raw =
                  Buffer.concat(chunks);

                resolve({

                  status:
                    res.statusCode,

                  body:
                    raw.toString('utf8')
                });
              }
            );
          }
        );

      req.on(
        'error',
        reject
      );

      req.write(bodyStr);

      req.end();
    }
  );
}


// ────────────────────────────────────────────────────────────────
// FAIL OPEN
// ────────────────────────────────────────────────────────────────

const FAIL_OPEN = true;


// ────────────────────────────────────────────────────────────────
// TWILIO HANDLER
// ────────────────────────────────────────────────────────────────

exports.handler =
  async function (
    context,
    event,
    callback
  ) {

    const response =
      new Twilio.Response();

    response.appendHeader(
      'Content-Type',
      'application/json'
    );

    try {

      // ────────────────────────────────────────────────────────
      // 1. Event information
      // ────────────────────────────────────────────────────────

      const eventType =
        event.EventType || null;





      // ────────────────────────────────────────────────────────
      // 2. Credentials
      // ────────────────────────────────────────────────────────

      const consumerId =
        context.WM_CONSUMER_ID ||
        FALLBACK_CONSUMER_ID;

      const keyVersion =
        context.WM_KEY_VERSION ||
        FALLBACK_KEY_VERSION;

      const privateKeyPem =
        certificate;


      // ────────────────────────────────────────────────────────
      // 3. Identify Conversation / Channel
      //
      // Different Twilio event types use different fields.
      //
      // Conversations:
      //     ConversationSid
      //
      // Interaction events:
      //     MediaChannelSid
      //
      // Channel:
      //     ChannelSid
      // ────────────────────────────────────────────────────────

      const conversationSid =
        event.ConversationSid ||
        event.MediaChannelSid ||
        null;

      const channelSid =
        event.ChannelSid ||
        null;

      const interactionSid =
        event.InteractionSid ||
        null;




      // ────────────────────────────────────────────────────────
      // 4. Extract common Twilio fields
      // ────────────────────────────────────────────────────────

      const accountSid =
        event.AccountSid || null;

      const author =
        event.Author || null;

      const participantSid =
        event.ParticipantSid || null;

      const messageSid =
        event.MessageSid || null;

      const contentSid =
        event.ContentSid || null;

      const dateCreated =
        event.DateCreated || null;

      const dateUpdated =
        event.DateUpdated || null;

      const delivery =
        event.Delivery || null;

      const index =
        event.Index || null;

      const links =
        event.Links || null;

      const messageUrl =
        event.Url || null;


      // ────────────────────────────────────────────────────────
      // 5. Interaction event specific fields
      // ────────────────────────────────────────────────────────

      const mediaChannelType =
        event.MediaChannelType || null;

      const channelStatus =
        event.ChannelStatus || null;


      // ────────────────────────────────────────────────────────
      // 6. Parse Attributes
      // ────────────────────────────────────────────────────────

      let attributes = {};

      try {

        if (event.Attributes) {

          attributes =
            typeof event.Attributes === 'string'
              ? JSON.parse(event.Attributes)
              : event.Attributes;
        }

      } catch (err) {

        console.log(
          '[ucmEmailEvent] Unable to parse Attributes. Continuing with empty attributes:',
          err.message
        );

        attributes = {};
      }


      // ────────────────────────────────────────────────────────
      // 7. Parse Media
      // ────────────────────────────────────────────────────────

      let media = [];

      try {

        if (event.Media) {

          media =
            typeof event.Media === 'string'
              ? JSON.parse(event.Media)
              : event.Media;
        }

      } catch (err) {

        console.log(
          '[ucmEmailEvent] Unable to parse Media. Continuing with empty media:',
          err.message
        );

        media = [];
      }


      // ────────────────────────────────────────────────────────
      // 8. COMPLETE TWILIO EVENT
      //
      // IMPORTANT:
      // Do NOT filter based on event type.
      //
      // Any future Twilio event will also be preserved.
      // ────────────────────────────────────────────────────────

      const messageBody =
        JSON.stringify(event);

      // ────────────────────────────────────────────────────────
      // 9. Determine Walmart object key
      //
      // Priority:
      //
      // 1. ConversationSid
      // 2. MediaChannelSid
      // 3. MessageSid
      // 4. ChannelSid
      // 5. InteractionSid
      // 6. EventType
      // 7. fallback
      // ────────────────────────────────────────────────────────

      const walmartObjectKey =
        conversationSid ||
        messageSid ||
        channelSid ||
        interactionSid ||
        eventType ||
        'twilio-event';


      // ────────────────────────────────────────────────────────
      // 10. BUILD WALMART REQUEST
      // ────────────────────────────────────────────────────────

      const requestBody = {

        [walmartObjectKey]: {

          account_sid:
            accountSid,

          attributes:
            attributes,

          author:
            author,

          body:
            messageBody,

          content_sid:
            contentSid,

          conversation_sid:
            conversationSid,

          date_created:
            dateCreated,

          date_updated:
            dateUpdated,

          delivery:
            delivery,

          index:
            index,

          links:
            links,

          media:
            media,

          participant_sid:
            participantSid,

          sid:
            messageSid,

          url:
            messageUrl,

          // Interaction / Channel fields

          event_type:
            eventType,

          channel_sid:
            channelSid,

          interaction_sid:
            interactionSid,

          media_channel_type:
            mediaChannelType,

          channel_status:
            channelStatus
        }
      };





      // ────────────────────────────────────────────────────────
      // 12. Generate A2A headers
      // ────────────────────────────────────────────────────────

      const authHeaders =
        buildAuthHeaders(
          consumerId,
          privateKeyPem,
          keyVersion
        );

      const requestHeaders = {

        ...authHeaders,

        'wm_svc.version':
          '1.0.0'
      };


      // ────────────────────────────────────────────────────────
      // 13. Call Walmart
      // ────────────────────────────────────────────────────────

      const result =
        await httpsPost(
          API_URL,
          requestHeaders,
          requestBody
        );


      // ────────────────────────────────────────────────────────
      // 14. Walmart response
      // ────────────────────────────────────────────────────────




      // ────────────────────────────────────────────────────────
      // 15. Return successful response to Twilio
      // ────────────────────────────────────────────────────────

      response.setStatusCode(200);

      response.setBody({

        success: true,

        event_type:
          eventType,

        conversation_sid:
          conversationSid,

        channel_sid:
          channelSid,

        interaction_sid:
          interactionSid,

        message_sid:
          messageSid,

        walmart_status:
          result.status
      });

      return callback(
        null,
        response
      );


    } catch (err) {

      console.error(
        '[ucmEmailEvent] ERROR:',
        err.message
      );

      console.error(
        '[ucmEmailEvent] STACK:',
        err.stack
      );


      if (FAIL_OPEN) {

        response.setStatusCode(200);

        response.setBody({

          success: false,

          error:
            err.message
        });

      } else {

        response.setStatusCode(500);

        response.setBody({

          success: false,

          error:
            err.message
        });
      }


      return callback(
        null,
        response
      );
    }
  };