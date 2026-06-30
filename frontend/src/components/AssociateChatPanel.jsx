import { useEffect, useRef, useState } from 'react';
import { GetConversationByTask } from '@twilio/flex-sdk/actions/Conversation';

export default function AssociateChatPanel({ flexClient, taskSid, worker, onEnd }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [conversation, setConversation] = useState(null);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!flexClient || !taskSid) return;
    let active = true;

    const messageAddedListener = (message) => {
      setMessages(prev => {
        if (prev.find(m => m.sid === message.sid)) return prev;
        return [...prev, {
          sid: message.sid,
          author: message.author,
          body: message.body,
          dateCreated: message.dateCreated,
        }];
      });
    };

    const init = async () => {
      try {
        const conv = await flexClient.execute(new GetConversationByTask(taskSid));
        if (!active) return;

        setConversation(conv);

        const paginator = await conv.getMessages();
        if (!active) return;

        setMessages(
          paginator.items.map(m => ({
            sid: m.sid,
            author: m.author,
            body: m.body,
            dateCreated: m.dateCreated,
          })).sort((a, b) => (a.dateCreated?.getTime() || 0) - (b.dateCreated?.getTime() || 0))
        );

        conv.conversation.on('messageAdded', messageAddedListener);
      } catch (err) {
        console.error('AssociateChatPanel init error:', err);
        if (active) setError('Unable to load conversation');
      }
    };

    init();

    return () => {
      active = false;
      if (conversation) {
        conversation.conversation.removeListener('messageAdded', messageAddedListener);
      }
    };
  }, [flexClient, taskSid]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || !conversation) return;
    const body = input.trim();
    setInput('');
    try {
      await conversation.sendMessage({ body });
    } catch (err) {
      console.error('sendMessage error:', err);
    }
  };

  const handleKey = e => { if (e.key === 'Enter') sendMessage(); };

  if (error) {
    return <div style={{ padding: 16, fontSize: 13, color: '#dc2626' }}>{error}</div>;
  }

  return (
    <div className="chat-window">
      {onEnd && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px', borderBottom: '1px solid #e5e7eb', background: 'white' }}>
          <button className="btn btn-danger" style={{ padding: '5px 12px', fontSize: 13 }} onClick={onEnd}>End Chat</button>
        </div>
      )}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div style={{ padding: '16px', fontSize: 13, color: '#9ca3af', textAlign: 'center' }}>
            Waiting for messages...
          </div>
        )}
        {messages.map(m => {
          const workerFriendlyName = worker?.friendlyName;
          const workerDisplayName = worker?.attributes?.full_name || workerFriendlyName;
          const normalizedAuthor = m.author?.replace(/_7C/g, '|');
          const isMine = normalizedAuthor === workerFriendlyName;
          const displayAuthor = isMine ? workerDisplayName : m.author;
          return (
            <div key={m.sid} className={`message ${isMine ? 'mine' : 'theirs'}`}>
              <div className="message-author">{displayAuthor}</div>
              {m.body}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-row">
        <input
          value={input}
          onChange={e => { setInput(e.target.value); conversation?.sendTyping?.(); }}
          onKeyDown={handleKey}
          placeholder="Type a message..."
        />
        <button className="btn btn-primary" onClick={sendMessage}>Send</button>
      </div>
    </div>
  );
}
