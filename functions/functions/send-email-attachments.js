const twilio = require('twilio');
const { Client } = require('@twilio/conversations');

// Sends ONE email carrying multiple attachments on an existing Email
// Conversation. The REST Create Message API (conv.messages.create) only binds
// the first MediaSid — any extra ones are silently dropped — so the message is
// posted through the Conversations client SDK instead, whose
// prepareMessage().addMedia() builder attaches every file to the same message.
//
// The SDK can only post as a chat identity, so SENDER_IDENTITY is added to the
// conversation for the duration of the send and removed afterwards. The email
// still goes out From the conversation's email binding address.
//
// POST body (JSON):
//   conversation_sid  CH... of an email conversation (required)
//   subject           email subject
//   body              plain-text body
//   html              HTML body (optional; sent as the rendered email body)
//   attachments       [{ filename, content_type, content }] where content is
//                     base64 — or { filename, content_type, url } to fetch it
const SENDER_IDENTITY = 'email-attachment-sender';

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

  const { conversation_sid, subject, body, html } = event;
  let attachments = event.attachments || [];
  if (typeof attachments === 'string') attachments = JSON.parse(attachments);

  if (!conversation_sid || !attachments.length) {
    response.setStatusCode(400);
    response.setBody({ error: 'conversation_sid and attachments are required' });
    return callback(null, response);
  }

  const SVC = context.CONVERSATIONS_SERVICE_SID;
  const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);
  const conv = client.conversations.v1.services(SVC).conversations(conversation_sid);
  let sdk;
  let participantSid;

  try {
    const files = await Promise.all(attachments.map(loadAttachment));

    // 1. Temporarily join the conversation as a chat identity.
    const participants = await conv.participants.list({ limit: 100 });
    if (!participants.some((p) => p.identity === SENDER_IDENTITY)) {
      participantSid = (await conv.participants.create({ identity: SENDER_IDENTITY })).sid;
    }

    // 2. Connect the client SDK with a short-lived token for that identity.
    const AccessToken = twilio.jwt.AccessToken;
    const token = new AccessToken(
      context.ACCOUNT_SID,
      context.API_KEY_SID,
      context.API_KEY_SECRET,
      { identity: SENDER_IDENTITY, ttl: 300 }
    );
    token.addGrant(new AccessToken.ChatGrant({ serviceSid: SVC }));
    sdk = await connectClient(token.toJwt());

    // 3. Build one message with every attachment and send it.
    const conversation = await sdk.getConversationBySid(conversation_sid);
    const builder = conversation.prepareMessage();
    if (subject) builder.setSubject(subject);
    if (body) builder.setBody(body);
    if (html) builder.setEmailBody('text/html', { contentType: 'text/html', media: Buffer.from(html) });
    for (const f of files) {
      builder.addMedia({ contentType: f.contentType, filename: f.filename, media: f.media });
    }
    const index = await builder.build().send();

    const [message] = await conv.messages.list({ order: 'desc', limit: 1 });
    response.setBody({
      conversation_sid,
      message_index: index,
      message_sid: message?.sid,
      media: (message?.media || [])
        .filter((m) => m.category === 'media')
        .map((m) => ({ sid: m.sid, filename: m.filename, content_type: m.content_type })),
    });

  } catch (err) {
    console.error('[send-email-attachments]', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message });
  }

  // Cleanup must finish before callback() — the Functions runtime stops
  // executing once the callback fires.
  if (sdk) await sdk.shutdown().catch(() => {});
  if (participantSid) {
    await conv.participants(participantSid).remove().catch((e) =>
      console.warn('[send-email-attachments] participant cleanup failed', e.message));
  }
  return callback(null, response);
};

function connectClient(jwt) {
  return new Promise((resolve, reject) => {
    const sdk = new Client(jwt);
    const timer = setTimeout(() => reject(new Error('Conversations SDK init timed out')), 8000);
    sdk.on('stateChanged', (state) => {
      if (state === 'initialized') { clearTimeout(timer); resolve(sdk); }
      if (state === 'failed') { clearTimeout(timer); reject(new Error('Conversations SDK init failed')); }
    });
  });
}

async function loadAttachment(a) {
  if (!a.filename || !a.content_type) {
    throw new Error('each attachment needs filename and content_type');
  }
  let media;
  if (a.content) {
    media = Buffer.from(a.content, 'base64');
  } else if (a.url) {
    const res = await fetch(a.url);
    if (!res.ok) throw new Error(`fetch ${a.filename} failed ${res.status}`);
    media = Buffer.from(await res.arrayBuffer());
  } else {
    throw new Error(`attachment ${a.filename} needs content (base64) or url`);
  }
  return { filename: a.filename, contentType: a.content_type, media };
}
