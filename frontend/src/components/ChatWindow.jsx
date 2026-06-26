import { useEffect, useState, useRef } from 'react';
import { Client } from '@twilio/conversations';

export default function ChatWindow({ baseUrl, conversationSid, identity, onEnd, caseId, channel, subject, sellerEmail }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [conversation, setConversation] = useState(null);
  const [client, setClient] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    let conversationsClient;

    fetch(`${baseUrl}/token?identity=${identity}`)
      .then(r => r.json())
      .then(async data => {
        conversationsClient = new Client(data.token);
        setClient(conversationsClient);

        conversationsClient.on('stateChanged', async state => {
          if (state === 'initialized') {
            const convo = await conversationsClient.getConversationBySid(conversationSid);
            setConversation(convo);

            const paginator = await convo.getMessages();
            setMessages(paginator.items.map(m => ({
              sid: m.sid,
              author: m.author,
              body: m.body,
            })));

            convo.on('messageAdded', msg => {
              setMessages(prev => [...prev, { sid: msg.sid, author: msg.author, body: msg.body }]);
            });
          }
        });
      })
      .catch(err => console.error('Chat init error', err));

    return () => {
      conversationsClient?.shutdown();
    };
  }, [conversationSid, identity]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || !conversation) return;
    await conversation.sendMessage(input.trim());
    setInput('');
  };

  const handleKey = e => {
    if (e.key === 'Enter') sendMessage();
  };

  const endChat = async (resolve) => {
    if (caseId) {
      await fetch(`${baseUrl}/resolve-case`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: caseId, resolve }),
      }).catch(console.error);
    }
    if (onEnd) onEnd(resolve);
  };

  return (
    <div className="chat-window">
      {onEnd && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '8px 12px', borderBottom: '1px solid #e5e7eb', background: 'white' }}>
          <button className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 13 }} onClick={() => endChat(false)}>
            Save &amp; Close
          </button>
          <button className="btn btn-success" style={{ padding: '5px 12px', fontSize: 13 }} onClick={() => endChat(true)}>
            Resolve
          </button>
        </div>
      )}
      {channel === 'email' && (
        <div className="email-meta-header">
          <div className="email-header-row"><span className="email-label">To</span><span className="email-value">{sellerEmail || 'seller'}</span></div>
          <div className="email-header-row"><span className="email-label">From</span><span className="email-value">support@retail.dotorg.icu</span></div>
          <div className="email-header-row"><span className="email-label">Subject</span><span className="email-value">{subject || caseId}</span></div>
        </div>
      )}
      <div className="chat-messages">
        {messages.map(m => (
          <div key={m.sid} className={`message ${m.author === identity ? 'mine' : 'theirs'}`}>
            <div className="message-author">{m.author}</div>
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
          placeholder="Type a message..."
        />
        <button className="btn btn-primary" onClick={sendMessage}>Send</button>
      </div>
    </div>
  );
}
