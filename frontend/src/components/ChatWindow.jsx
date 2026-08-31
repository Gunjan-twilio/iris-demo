import { useEffect, useState, useRef } from 'react';
import { Client as ConversationsClient } from '@twilio/conversations';

export default function ChatWindow({
  baseUrl,
  flexClient,
  taskSid,
  conversationSid,
  identity,
  onEnd,
  workerDisplayName,
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [conversationObj, setConversationObj] = useState(null);
  const [chatEnded, setChatEnded] = useState(false);
  const bottomRef = useRef(null);
  const clientRef = useRef(null);

  useEffect(() => {
    if (!conversationSid || !identity) return;
    let active = true;

    async function bindMessagingPipeline() {
      // Both associate and seller use seller-token endpoint with their respective identity.
      // Associate passes identity matching their authenticated Flex worker, seller passes their email.
      const res = await fetch(
        `${baseUrl}/seller-token?identity=${encodeURIComponent(identity)}`,
      );
      const data = await res.json();
      const client = await ConversationsClient.create(data.token);
      clientRef.current = client;

      const activeConversation =
        await client.getConversationBySid(conversationSid);
      if (!active) return;

      setConversationObj(activeConversation);
      setChatEnded(activeConversation.state?.current !== 'active');

      const paginator = await activeConversation.getMessages();
      if (!active) return;
      setMessages(
        paginator.items.map((m) => ({
          sid: m.sid,
          author: m.author,
          body: m.body,
        })),
      );

      activeConversation.on('messageAdded', (message) => {
        setMessages((prev) => {
          if (prev.find((m) => m.sid === message.sid)) return prev;
          return [
            ...prev,
            { sid: message.sid, author: message.author, body: message.body },
          ];
        });
      });

      activeConversation.on('updated', ({ updateReasons }) => {
        if (updateReasons.includes('state')) {
          setChatEnded(activeConversation.state?.current !== 'active');
        }
      });
    }

    bindMessagingPipeline().catch(console.error);

    return () => {
      active = false;
      clientRef.current?.shutdown();
      clientRef.current = null;
    };
  }, [conversationSid, identity]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || !conversationObj || chatEnded) return;
    const body = input.trim();
    setInput('');
    try {
      await conversationObj.sendMessage(body);
    } catch (err) {
      console.error('sendMessage error:', err);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter') sendMessage();
  };

  const handleEndChat = async () => {
    try {
      await fetch(`${baseUrl}/end-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationSid }),
      });
    } catch (err) {
      console.error('end-chat error:', err);
    }
    onEnd?.();
  };

  return (
    <div className='chat-window'>
      {onEnd && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '8px 12px',
            borderBottom: '1px solid #e5e7eb',
            background: 'white',
          }}
        >
          <button
            className='btn btn-ghost'
            style={{ padding: '5px 12px', fontSize: 13 }}
            onClick={handleEndChat}
            disabled={chatEnded}
          >
            End Chat
          </button>
        </div>
      )}
      {chatEnded && (
        <div
          style={{
            padding: '6px 12px',
            fontSize: 12,
            color: '#6b7280',
            background: '#F3F4F6',
            textAlign: 'center',
          }}
        >
          This chat has ended.
        </div>
      )}
      <div className='chat-messages'>
        {messages.map((m) => (
          <div
            key={m.sid}
            className={`message ${m.author === identity ? 'mine' : 'theirs'}`}
          >
            <div className='message-author'>
              {m.author === identity ? m.author : workerDisplayName || m.author}
            </div>
            {m.body}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className='chat-input-row'>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={chatEnded ? 'Chat ended' : 'Type a message...'}
          disabled={chatEnded}
        />
        <button className='btn btn-primary' onClick={sendMessage} disabled={chatEnded}>
          Send
        </button>
      </div>
    </div>
  );
}
