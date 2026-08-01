import { useEffect, useState, useRef } from 'react';
import { GetConversationByTask, EndTask, CompleteTask } from '@twilio/flex-sdk';

// here you may want threading based on all email conversations connected to a Case,
// perhaps using Case ID in the email subject as another thread identifier.
// For this demo, we assume one email thread per Case, and use the Flex taskSid to get the conversation.

export default function EmailThreadView({
  baseUrl,
  flexClient,
  taskSid,
  conversationSid,
  identity,
  caseId,
  subject,
  sellerEmail,
  onEnd,
  taskAttrs,
  channel,
}) {
  const [messages, setMessages] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [replyBody, setReplyBody] = useState('');
  const [replyHtml, setReplyHtml] = useState('');
  const [sending, setSending] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const msgListenerRef = useRef(null);

  // may need additional participant management if multiple participants are involved in the email thread.
  // For this demo, we assume only the associate and the seller are participants.
  const isAssociate = !!identity; // any identity passed in means we're the associate side

  // Load templates
  useEffect(() => {
    if (!isAssociate) return;
    fetch(`${baseUrl}/get-templates`)
      .then((r) => r.json())
      .then((data) => setTemplates(data.templates || []))
      .catch(console.error);
  }, [isAssociate]);

  // Render template when selected
  useEffect(() => {
    if (!selectedTemplate || !isAssociate) return;
    setLoadingPreview(true);
    fetch(`${baseUrl}/render-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: selectedTemplate,
        case_id: taskAttrs?.case_id || caseId,
        seller_name: taskAttrs?.seller_name || '',
        case_summary: taskAttrs?.case_summary || '',
        help_category: taskAttrs?.help_category || '',
        seller_email: sellerEmail || '',
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        setPreviewHtml(data.html || '');
        setReplyHtml(data.html || '');
        setReplyBody('');
      })
      .catch(console.error)
      .finally(() => setLoadingPreview(false));
  }, [selectedTemplate]);

  // Init conversation via flex-sdk
  useEffect(() => {
    if (!flexClient || !taskSid) return;
    let active = true;

    const init = async () => {
      try {
        // 1. Load aggregated case thread from backend — walks TaskRouter for
        // every task with this case_id and merges messages from all associated
        // conversations. Handles the "close-on-send / new ghost per reply"
        // architecture where a single case spans N conversations.
        const caseIdForFetch = taskAttrs?.case_id || caseId;
        let items = [];
        if (caseIdForFetch) {
          try {
            const threadRes = await fetch(
              `${baseUrl}/get-case-thread?case_id=${encodeURIComponent(caseIdForFetch)}`,
            );
            if (threadRes.ok) {
              const thread = await threadRes.json();
              items = (thread.messages || []).map((m) => ({
                sid: m.sid,
                author: m.author,
                body: m.body || '',
                subject: m.subject,
                htmlContent: undefined,
                dateCreated: m.dateCreated,
                conversationSid: m.conversationSid,
              }));
            }
          } catch (err) {
            console.warn('get-case-thread fetch failed', err);
          }
        }

        // 2. Get the CURRENT conversation via SDK for live message updates.
        const convo = await flexClient.execute(
          new GetConversationByTask(taskSid),
        );
        if (!active) return;
        setConversation(convo);

        // 3. Enrich messages on the current conversation with HTML bodies
        // (SDK-only capability). Older-conversation messages stay body-only.
        const currentSid = convo?.conversation?.sid;
        const currentMessagesById = {};
        try {
          const paginator = await convo.getMessages();
          for (const m of paginator.items) {
            let htmlContent;
            try {
              const url = await m
                .getEmailBody?.('text/html')
                ?.getContentTemporaryUrl?.();
              if (url) {
                const res = await fetch(url);
                htmlContent = await res.text();
              }
            } catch (_) {}
            currentMessagesById[m.sid] = { htmlContent, body: m.body, subject: m.subject };
          }
        } catch (_) {}

        // If the backend timeline is empty (e.g., new case, no case_id lookup),
        // fall back to the current conversation only.
        if (items.length === 0 && currentSid) {
          const paginator = await convo.getMessages();
          items = paginator.items.map((m) => ({
            sid: m.sid,
            author: m.author,
            body: m.body || '',
            subject: m.subject,
            htmlContent: currentMessagesById[m.sid]?.htmlContent,
            dateCreated: m.dateCreated,
            conversationSid: currentSid,
          }));
        } else {
          items = items.map((it) => {
            const enrichment = currentMessagesById[it.sid];
            return enrichment ? { ...it, htmlContent: enrichment.htmlContent } : it;
          });
        }

        setMessages(items);
        // Collapse all except the last
        const initial = {};
        items.slice(0, -1).forEach((m) => {
          initial[m.sid] = true;
        });
        setCollapsed(initial);

        // 4. Listen for new messages on the CURRENT conversation only —
        // older ghosts are closed and won't emit anything.
        const listener = async (msg) => {
          let htmlContent;
          try {
            const url = await msg
              .getEmailBody?.('text/html')
              ?.getContentTemporaryUrl?.();
            if (url) {
              const res = await fetch(url);
              htmlContent = await res.text();
            }
          } catch (_) {}
          setMessages((prev) => [
            ...prev,
            {
              sid: msg.sid,
              author: msg.author,
              body: msg.body,
              subject: msg.subject,
              htmlContent,
              dateCreated: msg.dateCreated,
              conversationSid: currentSid,
            },
          ]);
        };
        msgListenerRef.current = listener;
        convo.conversation.on('messageAdded', listener);
      } catch (err) {
        console.error('EmailThreadView init error:', err);
      }
    };

    init();
    return () => {
      active = false;
      if (conversation && msgListenerRef.current) {
        conversation.conversation?.removeListener(
          'messageAdded',
          msgListenerRef.current,
        );
      }
    };
  }, [flexClient, taskSid]);

  // simplified template management in this demo, you likely want to create a more robust
  // template management system in a production app, with a database and admin interface for creating/editing templates.
  const sendReply = async () => {
    if (sending || !conversation) return;
    const hasHtml = replyHtml.trim();
    const hasPlain = replyBody.trim();
    if (!hasHtml && !hasPlain) return;

    setSending(true);
    const html = hasHtml
      ? replyHtml.trim()
      : `<p>${replyBody.trim().replace(/\n/g, '<br>')}</p>`;
    const plain = html.replace(/<[^>]+>/g, '').trim();
    const msgOptions = { htmlBody: html, plainTextBody: plain, subject };

    try {
      if (channel === 'email_hybrid') {
        await sendHybridReply({ html, plain, msgOptions });
      } else {
        // OOTB `email` — let Twilio's built-in email dispatch handle it
        await conversation.sendMessage(msgOptions);
      }
      setReplyBody('');
      setReplyHtml('');
      setPreviewHtml('');
      setSelectedTemplate('');
    } catch (err) {
      console.error('Send error:', err);
    } finally {
      setSending(false);
    }
  };

  // email_hybrid participants dance: strip to/cc so Twilio's built-in email
  // dispatch can't fire → post the message via SDK (Twilio still tracks
  // ChannelMetadata) → SendGrid actually sends → restore participants.
  // readd runs in `finally` so a mid-flight failure never leaves the conversation
  // in a broken (no-participants) state.
  const sendHybridReply = async ({ html, plain, msgOptions }) => {
    const targetConvSid = conversationSid || taskAttrs?.conversationSid || taskAttrs?.conversation_sid;

    await fetch(`${baseUrl}/remove-email-participants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationSid: targetConvSid }),
    });

    let messageSid = '';
    try {
      // Post the message via the Twilio Conversations SDK builder pattern.
      // The Flex-SDK wrapper's `.sendMessage({htmlBody,plainTextBody,subject})`
      // path attempts Twilio's built-in email dispatch and fails when
      // participants have been stripped (our dance). `prepareMessage().build().send()`
      // records the message + ChannelMetadata without dispatching.
      const rawConv = conversation.conversation || conversation;
      const messageIndex = await rawConv
        .prepareMessage()
        .setSubject(subject)
        .setEmailBody('text/html', { contentType: 'text/html', media: html })
        .setEmailBody('text/plain', { contentType: 'text/plain', media: plain })
        .build()
        .send();

      // Retrieve the SDK-posted message SID for the ChannelMetadata lookup.
      try {
        const paginator = await rawConv.getMessages?.(1, messageIndex, 'backwards');
        const last = paginator?.items?.[0];
        messageSid = last?.sid || '';
      } catch (_) {}

      const sgRes = await fetch(`${baseUrl}/send-hybrid-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationSid: targetConvSid,
          caseId: taskAttrs?.case_id || '',
          messageSid,
          subject,
          htmlBody: html,
          plainBody: plain,
        }),
      });
      if (!sgRes.ok) {
        const errBody = await sgRes.json().catch(() => ({}));
        console.error('[sendHybridReply] SendGrid step failed', errBody);
      }
      
      
    } finally {
      // Always re-add participants so the conversation isn't left broken.
      await fetch(`${baseUrl}/readd-email-participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationSid: targetConvSid }),
      }).catch((err) => console.error('[sendHybridReply] readd failed', err));
    }
    
    // Fully close the task so the associate's email channel capacity is freed —
    // seller replies always spawn a new conversation/task, so there's nothing to
    // wrap up. EndTask moves reservation assigned → wrapping; CompleteTask then
    // moves it wrapping → completed. Wrapping alone still counts against capacity.
    try {
      await flexClient.execute(new EndTask(taskSid));
      await flexClient.execute(new CompleteTask(taskSid));
    } catch (err) {
      console.error('[sendHybridReply] task completion failed', err);
    }
  };

  const clearTemplate = () => {
    setSelectedTemplate('');
    setPreviewHtml('');
    setReplyHtml('');
  };

  const formatTime = (date) => {
    if (!date) return '';
    return new Date(date).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const displayName = (author) =>
    author === identity ? 'IRIS Support' : author;

  const toggleCollapse = (sid) =>
    setCollapsed((prev) => ({ ...prev, [sid]: !prev[sid] }));

  return (
    <div className='email-thread-view'>
      {/* Subject */}
      <div className='email-thread-subject'>
        <span className='email-thread-subject-text'>{subject || caseId}</span>
        {onEnd && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className='btn btn-ghost'
              style={{ padding: '4px 12px', fontSize: 12 }}
              onClick={() => onEnd(false)}
            >
              Save &amp; Close
            </button>
            <button
              className='btn btn-success'
              style={{ padding: '4px 12px', fontSize: 12 }}
              onClick={() => onEnd(true)}
            >
              Resolve
            </button>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className='email-thread-messages'>
        {messages.length === 0 && (
          <div className='empty-state' style={{ padding: '32px 0' }}>
            No messages yet
          </div>
        )}
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          const isCollapsedMsg = collapsed[m.sid];
          const isHtml = !m.htmlContent && /<[a-z][\s\S]*>/i.test(m.body);

          return (
            <div
              key={m.sid}
              className={`email-message-card ${isCollapsedMsg ? 'collapsed' : ''}`}
            >
              <div
                className='email-message-header'
                onClick={() => !isLast && toggleCollapse(m.sid)}
              >
                <div
                  className='email-message-avatar'
                  style={{
                    background: m.author === identity ? '#0b3d91' : '#6b7280',
                  }}
                >
                  {displayName(m.author).charAt(0).toUpperCase()}
                </div>
                <div className='email-message-meta'>
                  <span className='email-message-from'>
                    {displayName(m.author)}
                  </span>
                  {isCollapsedMsg && (
                    <span className='email-message-preview'>
                      {(m.body || '').replace(/<[^>]+>/g, '').substring(0, 60)}…
                    </span>
                  )}
                </div>
                <span className='email-message-time'>
                  {formatTime(m.dateCreated)}
                </span>
                {!isLast && (
                  <span className='email-message-toggle'>
                    {isCollapsedMsg ? '▾' : '▴'}
                  </span>
                )}
              </div>
              {!isCollapsedMsg && (
                <div className='email-message-body'>
                  {m.htmlContent ? (
                    <iframe
                      srcDoc={m.htmlContent}
                      style={{ width: '100%', border: 'none', minHeight: 200 }}
                      sandbox='allow-same-origin allow-scripts'
                      onLoad={(e) => {
                        e.target.style.height =
                          e.target.contentDocument?.body?.scrollHeight + 'px';
                      }}
                    />
                  ) : isHtml ? (
                    <iframe
                      srcDoc={m.body}
                      style={{ width: '100%', border: 'none', minHeight: 200 }}
                      sandbox='allow-same-origin allow-scripts'
                      onLoad={(e) => {
                        e.target.style.height =
                          e.target.contentDocument?.body?.scrollHeight + 'px';
                      }}
                    />
                  ) : (
                    m.body.split('\n').map((line, j) => (
                      <p key={j} style={{ margin: '0 0 4px 0' }}>
                        {line || <br />}
                      </p>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Reply area */}
      <div className='email-reply-area'>
        <div className='email-reply-header'>
          <span className='email-label'>Reply to</span>
          <span className='email-value'>
            {isAssociate ? sellerEmail || 'seller' : 'IRIS Support'}
          </span>
        </div>

        {isAssociate && (
          <div className='email-template-picker'>
            <select
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
              className='email-template-select'
            >
              <option value=''>— Use a template —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {selectedTemplate && (
              <button
                className='btn btn-ghost'
                style={{ fontSize: 12, padding: '4px 10px' }}
                onClick={clearTemplate}
              >
                Clear
              </button>
            )}
          </div>
        )}

        {loadingPreview && (
          <div style={{ padding: '16px', color: '#9ca3af', fontSize: 13 }}>
            Loading template...
          </div>
        )}
        {!loadingPreview && previewHtml && (
          <div className='email-template-preview'>
            <iframe
              srcDoc={previewHtml}
              style={{ width: '100%', border: 'none', minHeight: 200 }}
              sandbox='allow-same-origin'
              onLoad={(e) => {
                e.target.style.height =
                  e.target.contentDocument?.body?.scrollHeight + 'px';
              }}
            />
          </div>
        )}
        {!loadingPreview && !previewHtml && (
          <textarea
            className='email-reply-body'
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder='Write your reply...'
            rows={4}
          />
        )}

        <div className='email-reply-footer'>
          <button
            className='btn btn-primary'
            onClick={sendReply}
            disabled={sending || (!replyBody.trim() && !replyHtml.trim())}
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
