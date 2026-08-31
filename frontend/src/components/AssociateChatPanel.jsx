import { useEffect, useRef, useState } from 'react';
import { GetConversationByTask } from '@twilio/flex-sdk/actions/Conversation';

export default function AssociateChatPanel({ flexClient, taskSid, worker, onEnd }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [conversation, setConversation] = useState(null);
  const [error, setError] = useState(null);
  const [chatEnded, setChatEnded] = useState(false);
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
        setChatEnded(conv.conversation.state?.current !== 'active');

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
        conv.conversation.on('participantLeft', (participant) => {
          console.log('participantLeft event received', participant);
        });
        conv.conversation.on('participantJoined', (participant) => {
          console.log('participantJoined event received', participant);
        });
        conv.conversation.on('conversationRemoved', (conv) => {
          console.log('conversationRemoved event received', conv);
        });
        conv.conversation.on('updated', ({ updateReasons }) => {
          if (updateReasons.includes('state')) {
            setChatEnded(conv.conversation.state?.current !== 'active');
          }
        });
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
    if (!input.trim() || !conversation || chatEnded) return;
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
      {chatEnded && (
        <div style={{ padding: '6px 12px', fontSize: 12, color: '#6b7280', background: '#F3F4F6', textAlign: 'center' }}>
          This chat has ended.
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
          placeholder={chatEnded ? 'Chat ended' : 'Type a message...'}
          disabled={chatEnded}
        />
        <button className="btn btn-primary" onClick={sendMessage} disabled={chatEnded}>Send</button>
      </div>
    </div>
  );
}
