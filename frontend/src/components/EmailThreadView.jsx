import { useEffect, useState, useRef } from 'react';
import { GetConversationByTask } from '@twilio/flex-sdk';

export default function EmailThreadView({ baseUrl, flexClient, taskSid, conversationSid, identity, caseId, subject, sellerEmail, onEnd, taskAttrs }) {
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

  const isAssociate = !!identity; // any identity passed in means we're the associate side

  // Load templates
  useEffect(() => {
    if (!isAssociate) return;
    fetch(`${baseUrl}/get-templates`)
      .then(r => r.json())
      .then(data => setTemplates(data.templates || []))
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
      .then(r => r.json())
      .then(data => {
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
        const convo = await flexClient.execute(new GetConversationByTask(taskSid));
        if (!active) return;

        setConversation(convo);

        // Load message history
        const paginator = await convo.getMessages();
        const items = await Promise.all(paginator.items.map(async m => {
          let htmlContent;
          try {
            const url = await m.getEmailBody?.('text/html')?.getContentTemporaryUrl?.();
            if (url) {
              const res = await fetch(url);
              htmlContent = await res.text();
            }
          } catch (_) {}
          return {
            sid: m.sid,
            author: m.author,
            body: m.body,
            subject: m.subject,
            htmlContent,
            dateCreated: m.dateCreated,
          };
        }));

        setMessages(items);
        // Collapse all except the last
        const initial = {};
        items.slice(0, -1).forEach(m => { initial[m.sid] = true; });
        setCollapsed(initial);

        // Listen for new messages via the inner Twilio Conversations object
        const listener = async (msg) => {
          let htmlContent;
          try {
            const url = await msg.getEmailBody?.('text/html')?.getContentTemporaryUrl?.();
            if (url) {
              const res = await fetch(url);
              htmlContent = await res.text();
            }
          } catch (_) {}
          setMessages(prev => [...prev, {
            sid: msg.sid,
            author: msg.author,
            body: msg.body,
            subject: msg.subject,
            htmlContent,
            dateCreated: msg.dateCreated,
          }]);
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
        conversation.conversation?.removeListener('messageAdded', msgListenerRef.current);
      }
    };
  }, [flexClient, taskSid]);

  const sendReply = async () => {
    if (sending || !conversation) return;
    const hasHtml = replyHtml.trim();
    const hasPlain = replyBody.trim();
    if (!hasHtml && !hasPlain) return;

    setSending(true);
    try {
      const html = hasHtml ? replyHtml.trim() : `<p>${replyBody.trim().replace(/\n/g, '<br>')}</p>`;
      const plain = html.replace(/<[^>]+>/g, '').trim();
      const msgOptions = { htmlBody: html, plainTextBody: plain, subject };
      console.log('[sendReply] conversation type:', typeof conversation, 'keys:', Object.keys(conversation || {}));
      console.log('[sendReply] msgOptions:', msgOptions);
      await conversation.sendMessage(msgOptions);
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

  const clearTemplate = () => {
    setSelectedTemplate('');
    setPreviewHtml('');
    setReplyHtml('');
  };

  const formatTime = (date) => {
    if (!date) return '';
    return new Date(date).toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  };

  const displayName = (author) => author === identity ? 'IRIS Support' : author;

  const toggleCollapse = (sid) => setCollapsed(prev => ({ ...prev, [sid]: !prev[sid] }));

  return (
    <div className="email-thread-view">
      {/* Subject */}
      <div className="email-thread-subject">
        <span className="email-thread-subject-text">{subject || caseId}</span>
        {onEnd && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => onEnd(false)}>Save &amp; Close</button>
            <button className="btn btn-success" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => onEnd(true)}>Resolve</button>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="email-thread-messages">
        {messages.length === 0 && (
          <div className="empty-state" style={{ padding: '32px 0' }}>No messages yet</div>
        )}
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          const isCollapsedMsg = collapsed[m.sid];
          const isHtml = !m.htmlContent && /<[a-z][\s\S]*>/i.test(m.body);

          return (
            <div key={m.sid} className={`email-message-card ${isCollapsedMsg ? 'collapsed' : ''}`}>
              <div className="email-message-header" onClick={() => !isLast && toggleCollapse(m.sid)}>
                <div className="email-message-avatar" style={{ background: m.author === identity ? '#0b3d91' : '#6b7280' }}>
                  {displayName(m.author).charAt(0).toUpperCase()}
                </div>
                <div className="email-message-meta">
                  <span className="email-message-from">{displayName(m.author)}</span>
                  {isCollapsedMsg && (
                    <span className="email-message-preview">
                      {(m.body || '').replace(/<[^>]+>/g, '').substring(0, 60)}…
                    </span>
                  )}
                </div>
                <span className="email-message-time">{formatTime(m.dateCreated)}</span>
                {!isLast && <span className="email-message-toggle">{isCollapsedMsg ? '▾' : '▴'}</span>}
              </div>
              {!isCollapsedMsg && (
                <div className="email-message-body">
                  {m.htmlContent
                    ? <iframe srcDoc={m.htmlContent} style={{ width: '100%', border: 'none', minHeight: 200 }} sandbox="allow-same-origin allow-scripts" onLoad={e => { e.target.style.height = e.target.contentDocument?.body?.scrollHeight + 'px'; }} />
                    : isHtml
                      ? <iframe srcDoc={m.body} style={{ width: '100%', border: 'none', minHeight: 200 }} sandbox="allow-same-origin allow-scripts" onLoad={e => { e.target.style.height = e.target.contentDocument?.body?.scrollHeight + 'px'; }} />
                      : m.body.split('\n').map((line, j) => <p key={j} style={{ margin: '0 0 4px 0' }}>{line || <br />}</p>)
                  }
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Reply area */}
      <div className="email-reply-area">
        <div className="email-reply-header">
          <span className="email-label">Reply to</span>
          <span className="email-value">{isAssociate ? (sellerEmail || 'seller') : 'IRIS Support'}</span>
        </div>

        {isAssociate && (
          <div className="email-template-picker">
            <select value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)} className="email-template-select">
              <option value="">— Use a template —</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {selectedTemplate && (
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={clearTemplate}>Clear</button>
            )}
          </div>
        )}

        {loadingPreview && <div style={{ padding: '16px', color: '#9ca3af', fontSize: 13 }}>Loading template...</div>}
        {!loadingPreview && previewHtml && (
          <div className="email-template-preview">
            <iframe srcDoc={previewHtml} style={{ width: '100%', border: 'none', minHeight: 200 }} sandbox="allow-same-origin" onLoad={e => { e.target.style.height = e.target.contentDocument?.body?.scrollHeight + 'px'; }} />
          </div>
        )}
        {!loadingPreview && !previewHtml && (
          <textarea
            className="email-reply-body"
            value={replyBody}
            onChange={e => setReplyBody(e.target.value)}
            placeholder="Write your reply..."
            rows={4}
          />
        )}

        <div className="email-reply-footer">
          <button
            className="btn btn-primary"
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
