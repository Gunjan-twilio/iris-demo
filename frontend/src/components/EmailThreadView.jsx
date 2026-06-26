import { useEffect, useState, useRef } from 'react';
import { Client } from '@twilio/conversations';

export default function EmailThreadView({ baseUrl, conversationSid, identity, caseId, subject, sellerEmail, onEnd }) {
  const [messages, setMessages] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [replyBody, setReplyBody] = useState('');
  const [sending, setSending] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const replyRef = useRef(null);

  const isAssociate = identity === 'associate1';

  useEffect(() => {
    let conversationsClient;

    fetch(`${baseUrl}/token?identity=${identity}`)
      .then(r => r.json())
      .then(async data => {
        conversationsClient = new Client(data.token);

        conversationsClient.on('stateChanged', async state => {
          if (state === 'initialized') {
            const convo = await conversationsClient.getConversationBySid(conversationSid);
            setConversation(convo);

            const paginator = await convo.getMessages();
            const items = paginator.items.map(m => ({
              sid: m.sid,
              author: m.author,
              body: m.body,
              dateCreated: m.dateCreated,
            }));
            setMessages(items);
            // Collapse all but the last message by default
            const initial = {};
            items.slice(0, -1).forEach(m => { initial[m.sid] = true; });
            setCollapsed(initial);

            convo.on('messageAdded', msg => {
              setMessages(prev => [...prev, {
                sid: msg.sid,
                author: msg.author,
                body: msg.body,
                dateCreated: msg.dateCreated,
              }]);
              // New messages arrive expanded
            });
          }
        });
      })
      .catch(err => console.error('Email thread init error', err));

    return () => { conversationsClient?.shutdown(); };
  }, [conversationSid, identity]);

  const sendReply = async () => {
    if (!replyBody.trim() || !conversation || sending) return;
    setSending(true);
    try {
      await conversation.sendMessage(replyBody.trim());
      setReplyBody('');
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  const formatTime = (date) => {
    if (!date) return '';
    return new Date(date).toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  };

  const displayName = (author) => {
    if (author === 'associate1') return 'IRIS Support';
    return author;
  };

  const toggleCollapse = (sid) => {
    setCollapsed(prev => ({ ...prev, [sid]: !prev[sid] }));
  };

  return (
    <div className="email-thread-view">
      {/* Thread subject header */}
      <div className="email-thread-subject">
        <span className="email-thread-subject-text">{subject || caseId}</span>
        {onEnd && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => onEnd(false)}>Save &amp; Close</button>
            <button className="btn btn-success" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => onEnd(true)}>Resolve</button>
          </div>
        )}
      </div>

      {/* Message cards */}
      <div className="email-thread-messages">
        {messages.length === 0 && (
          <div className="empty-state" style={{ padding: '32px 0' }}>No messages yet</div>
        )}
        {messages.map((m, i) => {
          const isMe = m.author === identity || (isAssociate && m.author === 'associate1');
          const isLast = i === messages.length - 1;
          const isCollapsed = collapsed[m.sid];

          return (
            <div key={m.sid} className={`email-message-card ${isCollapsed ? 'collapsed' : ''}`}>
              <div className="email-message-header" onClick={() => !isLast && toggleCollapse(m.sid)}>
                <div className="email-message-avatar" style={{ background: isMe ? '#0b3d91' : '#6b7280' }}>
                  {displayName(m.author).charAt(0).toUpperCase()}
                </div>
                <div className="email-message-meta">
                  <span className="email-message-from">{displayName(m.author)}</span>
                  {isCollapsed && (
                    <span className="email-message-preview">{m.body.substring(0, 60)}{m.body.length > 60 ? '…' : ''}</span>
                  )}
                </div>
                <span className="email-message-time">{formatTime(m.dateCreated)}</span>
                {!isLast && (
                  <span className="email-message-toggle">{isCollapsed ? '▾' : '▴'}</span>
                )}
              </div>
              {!isCollapsed && (
                <div className="email-message-body">
                  {m.body.split('\n').map((line, j) => (
                    <p key={j} style={{ margin: '0 0 4px 0' }}>{line || <br />}</p>
                  ))}
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
        <textarea
          ref={replyRef}
          className="email-reply-body"
          value={replyBody}
          onChange={e => setReplyBody(e.target.value)}
          placeholder="Write your reply..."
          rows={4}
        />
        <div className="email-reply-footer">
          <button className="btn btn-primary" onClick={sendReply} disabled={sending || !replyBody.trim()}>
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
