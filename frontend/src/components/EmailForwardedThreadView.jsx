import { useEffect, useState, useRef } from 'react';
import { Client as ConversationsClient } from '@twilio/conversations';

// email_forwarded uses a plain Conversation (not Flex Interactions), so we can't
// call GetConversationByTask like OOTB EmailThreadView. Fetch the conversation
// directly via ConversationsClient (same pattern as ChatWindow). Send via
// conversation.sendMessage — the outbound-email-forwarded webhook picks it up
// and dispatches via SendGrid to the seller's real inbox.

export default function EmailForwardedThreadView({
  baseUrl,
  conversationSid,
  identity,
  caseId,
  subject,
  sellerEmail,
  onEnd,
}) {
  const [messages, setMessages] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [replyBody, setReplyBody] = useState('');
  const [sending, setSending] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const clientRef = useRef(null);

  useEffect(() => {
    if (!conversationSid || !identity) return;
    let active = true;

    (async () => {
      try {
        const res = await fetch(
          `${baseUrl}/seller-token?identity=${encodeURIComponent(identity)}`,
        );
        const { token } = await res.json();
        const client = await ConversationsClient.create(token);
        clientRef.current = client;

        const convo = await client.getConversationBySid(conversationSid);
        if (!active) return;
        setConversation(convo);

        const paginator = await convo.getMessages();
        if (!active) return;
        const items = paginator.items.map((m) => ({
          sid: m.sid,
          author: m.author,
          body: m.body,
          dateCreated: m.dateCreated,
        }));
        setMessages(items);
        const initial = {};
        items.slice(0, -1).forEach((m) => { initial[m.sid] = true; });
        setCollapsed(initial);

        convo.on('messageAdded', (msg) => {
          setMessages((prev) => {
            if (prev.find((m) => m.sid === msg.sid)) return prev;
            return [...prev, {
              sid: msg.sid,
              author: msg.author,
              body: msg.body,
              dateCreated: msg.dateCreated,
            }];
          });
        });
      } catch (err) {
        console.error('EmailForwardedThreadView init error:', err);
      }
    })();

    return () => {
      active = false;
      clientRef.current?.shutdown();
      clientRef.current = null;
    };
  }, [conversationSid, identity]);

  const sendReply = async () => {
    if (sending || !conversation || !replyBody.trim()) return;
    setSending(true);
    try {
      await conversation.sendMessage(replyBody.trim());
      setReplyBody('');
    } catch (err) {
      console.error('Send error:', err);
    } finally {
      setSending(false);
    }
  };

  const formatTime = (date) => {
    if (!date) return '';
    return new Date(date).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
    });
  };

  const isFromAssociate = (author) => author === identity;
  const displayName = (author) => (isFromAssociate(author) ? 'Walmart Support' : author);
  const toggleCollapse = (sid) => setCollapsed((prev) => ({ ...prev, [sid]: !prev[sid] }));

  return (
    <div className='email-thread-view'>
      <div className='email-thread-subject'>
        <span className='email-thread-subject-text'>{subject || caseId}</span>
        <span style={{ marginLeft: 8, fontSize: 11, color: '#6b7280', fontWeight: 500 }}>
          via SendGrid · From: support@walmart.com
        </span>
        {onEnd && (
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button className='btn btn-ghost' style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => onEnd(false)}>
              Save &amp; Close
            </button>
            <button className='btn btn-success' style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => onEnd(true)}>
              Resolve
            </button>
          </div>
        )}
      </div>

      <div className='email-thread-messages'>
        {messages.length === 0 && (
          <div className='empty-state' style={{ padding: '32px 0' }}>No messages yet</div>
        )}
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          const isCollapsedMsg = collapsed[m.sid];
          const preview = (m.body || '').substring(0, 60);

          return (
            <div key={m.sid} className={`email-message-card ${isCollapsedMsg ? 'collapsed' : ''}`}>
              <div className='email-message-header' onClick={() => !isLast && toggleCollapse(m.sid)}>
                <div className='email-message-avatar' style={{ background: isFromAssociate(m.author) ? '#0b3d91' : '#6b7280' }}>
                  {displayName(m.author).charAt(0).toUpperCase()}
                </div>
                <div className='email-message-meta'>
                  <span className='email-message-from'>{displayName(m.author)}</span>
                  {isCollapsedMsg && <span className='email-message-preview'>{preview}…</span>}
                </div>
                <span className='email-message-time'>{formatTime(m.dateCreated)}</span>
                {!isLast && <span className='email-message-toggle'>{isCollapsedMsg ? '▾' : '▴'}</span>}
              </div>
              {!isCollapsedMsg && (
                <div className='email-message-body'>
                  {m.body.split('\n').map((line, j) => (
                    <p key={j} style={{ margin: '0 0 4px 0' }}>{line || <br />}</p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className='email-reply-area'>
        <div className='email-reply-header'>
          <span className='email-label'>Reply to</span>
          <span className='email-value'>{sellerEmail || 'seller'}</span>
        </div>
        <textarea
          className='email-reply-body'
          value={replyBody}
          onChange={(e) => setReplyBody(e.target.value)}
          placeholder='Write your reply...'
          rows={4}
        />
        <div className='email-reply-footer'>
          <button
            className='btn btn-primary'
            onClick={sendReply}
            disabled={sending || !replyBody.trim()}
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
