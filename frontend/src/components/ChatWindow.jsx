import { useEffect, useState, useRef } from 'react';
import { GetConversationByTask } from '@twilio/flex-sdk';
import { Client as ConversationsClient } from '@twilio/conversations';

export default function ChatWindow({ baseUrl, flexClient, taskSid, conversationSid, identity, onEnd, caseId }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [conversation, setConversation] = useState(null);
  const bottomRef = useRef(null);
  const msgListenerRef = useRef(null);

  useEffect(() => {
    if (!conversationSid) return;
    let active = true;
    let convosClient;

    const initViaFlexSdk = async () => {
      try {
        const convo = await flexClient.execute(new GetConversationByTask(taskSid));
        if (!active) return;
        setConversation(convo);
        const paginator = await convo.getMessages();
        setMessages(paginator.items.map(m => ({ sid: m.sid, author: m.author, body: m.body })));
        const listener = msg => setMessages(prev => [...prev, { sid: msg.sid, author: msg.author, body: msg.body }]);
        msgListenerRef.current = listener;
        convo.conversation.on('messageAdded', listener);
      } catch (err) {
        console.error('Chat init (flex-sdk) error:', err);
        // Forbidden / binding not set up — fall back to raw Conversations SDK via conversationSid
        if (conversationSid) {
          console.warn('[ChatWindow] Falling back to raw Conversations SDK for conversationSid:', conversationSid);
          initViaConversationsClient().catch(e => console.error('Chat init (conversations fallback) error:', e));
        }
      }
    };

    const initViaConversationsClient = async () => {
      // Seller side — use raw Conversations SDK
      const res = await fetch(`${baseUrl}/seller-token?identity=${identity}`);
      const data = await res.json();
      convosClient = new ConversationsClient(data.token);
      convosClient.on('stateChanged', async state => {
        if (state !== 'initialized' || !active) return;
        const convo = await convosClient.getConversationBySid(conversationSid);
        setConversation(convo);
        const paginator = await convo.getMessages();
        setMessages(paginator.items.map(m => ({ sid: m.sid, author: m.author, body: m.body })));
        const listener = msg => setMessages(prev => [...prev, { sid: msg.sid, author: msg.author, body: msg.body }]);
        msgListenerRef.current = listener;
        convo.on('messageAdded', listener);
      });
    };

    console.log('[ChatWindow] flexClient:', !!flexClient, 'taskSid:', taskSid, 'conversationSid:', conversationSid, 'identity:', identity);
    if (flexClient && taskSid) {
      initViaFlexSdk();
    } else {
      initViaConversationsClient().catch(err => console.error('Chat init (conversations) error:', err));
    }

    return () => {
      active = false;
      convosClient?.shutdown();
      if (conversation && msgListenerRef.current) {
        if (conversation.conversation) {
          conversation.conversation.removeListener('messageAdded', msgListenerRef.current);
        } else {
          conversation.removeListener('messageAdded', msgListenerRef.current);
        }
      }
    };
  }, [conversationSid, identity, taskSid]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || !conversation) return;
    const body = input.trim();
    setInput('');
    try {
      // Flex SDK wrapper: sendMessage takes options object; raw Conversations SDK: takes string
      if (conversation.conversation) {
        await conversation.sendMessage({ body });
      } else {
        await conversation.sendMessage(body);
      }
    } catch (err) {
      console.error('sendMessage error:', err);
    }
  };

  const handleKey = e => { if (e.key === 'Enter') sendMessage(); };

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
          <button className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 13 }} onClick={() => endChat(false)}>Save &amp; Close</button>
          <button className="btn btn-success" style={{ padding: '5px 12px', fontSize: 13 }} onClick={() => endChat(true)}>Resolve</button>
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
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey} placeholder="Type a message..." />
        <button className="btn btn-primary" onClick={sendMessage}>Send</button>
      </div>
    </div>
  );
}
