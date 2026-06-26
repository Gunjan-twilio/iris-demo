import { useState, useEffect, useRef } from 'react';

export default function EmailThread({ baseUrl, caseId, sellerEmail, onEnd }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const pollRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    fetchMessages();
    pollRef.current = setInterval(fetchMessages, 3000);
    return () => clearInterval(pollRef.current);
  }, [caseId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchMessages = async () => {
    try {
      const res = await fetch(`${baseUrl}/get-email-messages?case_id=${caseId}`);
      const data = await res.json();
      setMessages(data.messages || []);
    } catch (err) {
      console.error('Email poll error', err);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      await fetch(`${baseUrl}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          case_id: caseId,
          to_email: sellerEmail,
          body: input.trim(),
          subject: `[${caseId}] Support Request`,
        }),
      });
      setInput('');
      await fetchMessages();
    } catch (err) {
      console.error('Send error', err);
    } finally {
      setSending(false);
    }
  };

  const handleKey = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  return (
    <div className="chat-window">
      {onEnd && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #e5e7eb', background: 'white' }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>Email thread with {sellerEmail}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 13 }} onClick={() => onEnd(false)}>
              Save &amp; Close
            </button>
            <button className="btn btn-success" style={{ padding: '5px 12px', fontSize: 13 }} onClick={() => onEnd(true)}>
              Resolve
            </button>
          </div>
        </div>
      )}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', marginTop: 20 }}>
            No messages yet — send the first email below
          </div>
        )}
        {messages.map(m => (
          <div key={m.id} className={`message ${m.direction === 'outbound' ? 'mine' : 'theirs'}`}>
            <div className="message-author">{m.direction === 'outbound' ? 'associate1' : m.author}</div>
            {m.body}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-row">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Type an email message..."
        />
        <button className="btn btn-primary" onClick={sendMessage} disabled={sending}>
          {sending ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
