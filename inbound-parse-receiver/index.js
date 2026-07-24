import express from 'express';
import multer from 'multer';
import { simpleParser } from 'mailparser';

const upload = multer();
const app = express();
const PORT = process.env.PORT || 3000;

const TWILIO_FUNCTIONS_DOMAIN = process.env.TWILIO_FUNCTIONS_DOMAIN;
const RELAY_TOKEN = process.env.RELAY_TOKEN;
const SENDGRID_INBOUND_TOKEN = process.env.SENDGRID_INBOUND_TOKEN;

if (!TWILIO_FUNCTIONS_DOMAIN) {
  console.error('TWILIO_FUNCTIONS_DOMAIN env var is required');
  process.exit(1);
}

app.get('/', (_req, res) => res.send('iris-inbound-parse ok'));

// SendGrid Inbound Parse target. Receives multipart, parses the forwarded body
// to recover the original seller identity (Exchange forwarding overwrites the
// RFC From/To headers), then relays clean JSON to a Twilio Function.
app.post('/inbound', upload.any(), async (req, res) => {
  if (SENDGRID_INBOUND_TOKEN && req.query.token !== SENDGRID_INBOUND_TOKEN) {
    return res.status(401).send('unauthorized');
  }

  const body = req.body || {};
  let rfcFrom = body.from || '';
  let rfcTo = body.to || '';
  let subject = body.subject || '';
  let text = body.text || '';
  let html = body.html || '';
  let headers = body.headers || '';
  let messageId = '';
  let inReplyTo = '';
  let referencesArr = [];

  // If SendGrid Inbound Parse is in "raw MIME" mode, text/html/from arrive
  // packed inside body.email as an RFC-822 message. Parse it out.
  if (!text && !html && body.email) {
    try {
      const parsed = await simpleParser(body.email);
      text = parsed.text || text;
      html = parsed.html || html;
      subject = subject || parsed.subject || '';
      rfcFrom = rfcFrom || (parsed.from && parsed.from.text) || '';
      rfcTo = rfcTo || (parsed.to && parsed.to.text) || '';
      headers = headers || (parsed.headerLines || []).map((h) => h.line).join('\n');
      messageId = parsed.messageId || '';
      inReplyTo = parsed.inReplyTo || '';
      referencesArr = Array.isArray(parsed.references)
        ? parsed.references
        : (parsed.references ? [parsed.references] : []);
    } catch (err) {
      console.warn('[inbound] mailparser failed', err.message);
    }
  }

  // In SendGrid's parsed-fields mode, threading lives inside body.headers as raw RFC lines.
  if (!messageId || !inReplyTo || !referencesArr.length) {
    const hdrMap = parseHeaderBlock(headers);
    messageId = messageId || hdrMap['message-id'] || '';
    inReplyTo = inReplyTo || hdrMap['in-reply-to'] || '';
    if (!referencesArr.length && hdrMap['references']) {
      referencesArr = hdrMap['references'].split(/\s+/).filter(Boolean);
    }
  }

  // Auto-reply / bulk filter
  if (/^Auto-Submitted:\s*auto/im.test(headers) || /^Precedence:\s*bulk/im.test(headers)) {
    console.log('[inbound] dropped auto-reply/bulk');
    return res.status(200).send('ok');
  }

  const parsed = parseForwardedBody(text, html);
  const rfcFromEmail = extractEmail(rfcFrom);
  // Prefer RFC From (ImprovMX/Cloudflare preserve it via SRS; direct Gmail →
  // Parse also keeps it intact). Only fall back to a body-extracted From when
  // the RFC value is missing OR the wrapping forwarder rewrote it to an
  // infrastructure address on our own sending domain.
  const outboundDomain = ((process.env.FROM_EMAIL || '').split('@')[1] || '').toLowerCase();
  const rfcFromIsOurInfra = outboundDomain && rfcFromEmail.endsWith('@' + outboundDomain);
  const sellerEmail = (!rfcFromEmail || rfcFromIsOurInfra)
    ? (parsed.originalFrom || rfcFromEmail)
    : rfcFromEmail;
  const caseId = extractCaseId(subject) || extractCaseId(text);
  const messageBody = parsed.cleanBody || text;

  console.log('[inbound] parsed', { sellerEmail, caseId, rfcFrom, rfcTo, subject, messageId, inReplyTo, referencesArr });

  if (!sellerEmail || !caseId) {
    console.warn('[inbound] missing sellerEmail or caseId — dropping');
    return res.status(200).send('missing_identity');
  }

  try {
    const relayRes = await fetch(`https://${TWILIO_FUNCTIONS_DOMAIN}/inbound-parse-relay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(RELAY_TOKEN ? { 'X-Relay-Token': RELAY_TOKEN } : {}),
      },
      body: JSON.stringify({
        case_id: caseId,
        seller_email: sellerEmail,
        subject,
        message: messageBody,
        message_id: messageId,
        in_reply_to: inReplyTo,
        references: referencesArr,
      }),
    });
    const relayText = await relayRes.text();
    console.log('[inbound] relay response', relayRes.status, relayText);
    return res.status(200).send('ok');
  } catch (err) {
    console.error('[inbound] relay error', err);
    return res.status(500).send('relay_failed');
  }
});

// Extract "user@host" from an RFC From value like `"Austin" <austin@gmail.com>`
function extractEmail(field) {
  if (!field) return '';
  const m = field.match(/<([^>]+)>/) || field.match(/([\w.+-]+@[\w.-]+\.[a-z]{2,})/i);
  return (m ? m[1] : '').trim().toLowerCase();
}

// Case-XXXXX (dash or space, either bracket or bare)
function extractCaseId(source) {
  if (!source) return '';
  const m = source.match(/CASE[-\s]?(\d{5,})/i);
  return m ? `CASE-${m[1]}` : '';
}

// Forwarded email bodies from Exchange / Gmail / Outlook include the original
// From/To/Sent lines above a quoted reply. Recover the original sender and
// strip the quote history so the associate sees just the seller's new message.
function parseForwardedBody(text, html) {
  const source = text || stripHtml(html) || '';
  let originalFrom = '';

  // Common forward header patterns:
  //   From: "Austin" <austin@gmail.com>
  //   From: austin@gmail.com
  //   On Wed, Jul 23, 2026, Austin <austin@gmail.com> wrote:
  const fromLine = source.match(/^\s*From:\s*(.+)$/im);
  if (fromLine) originalFrom = extractEmail(fromLine[1]);

  if (!originalFrom) {
    const wroteLine = source.match(/On\b[^\n]+<([^>]+)>\s*wrote:/i);
    if (wroteLine) originalFrom = wroteLine[1].trim().toLowerCase();
  }

  // Clean body: take everything BEFORE the forwarded/quoted section.
  const markers = [
    /^-{2,}\s*Forwarded message\s*-{2,}/im,
    /^-{2,}\s*Original Message\s*-{2,}/im,
    /^On\b[^\n]+wrote:\s*$/im,
    /^From:\s+/im,
  ];
  let cutIdx = source.length;
  for (const re of markers) {
    const m = source.match(re);
    if (m && m.index !== undefined && m.index < cutIdx) cutIdx = m.index;
  }
  const cleanBody = source.slice(0, cutIdx).trim();

  return { originalFrom, cleanBody };
}

// Parse an RFC 822 header block ("Header-Name: value\n...") into a lowercased-key map.
function parseHeaderBlock(block) {
  const map = {};
  if (!block) return map;
  const lines = String(block).split(/\r?\n/);
  let currentKey = '';
  for (const line of lines) {
    if (/^\s/.test(line) && currentKey) {
      map[currentKey] += ' ' + line.trim();
      continue;
    }
    const m = line.match(/^([A-Za-z0-9-]+):\s*(.*)$/);
    if (!m) continue;
    currentKey = m[1].toLowerCase();
    map[currentKey] = m[2].trim();
  }
  return map;
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>(?=\s|$)/gi, '\n')
    .replace(/<\/(p|div|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

app.listen(PORT, () => {
  console.log(`iris-inbound-parse listening on ${PORT} → relay ${TWILIO_FUNCTIONS_DOMAIN}`);
});
