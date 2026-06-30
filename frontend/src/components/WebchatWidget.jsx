import { useEffect, useState } from 'react';
import ChatWindow from './ChatWindow.jsx';

export default function WebchatWidget({ baseUrl, sellerName, sellerEmail, helpCategory, caseSummary, onEnd }) {
  const [conversationSid, setConversationSid] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${baseUrl}/create-webchat-interaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seller_name: sellerName,
        seller_email: sellerEmail,
        help_category: helpCategory,
        case_summary: caseSummary || '',
      }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.conversation_sid) setConversationSid(data.conversation_sid);
        else setError('Failed to start chat session');
      })
      .catch(() => setError('Failed to start chat session'));
  }, []);

  if (error) {
    return <div style={{ padding: 16, fontSize: 13, color: '#dc2626' }}>{error}</div>;
  }

  if (!conversationSid) {
    return <div style={{ padding: 16, fontSize: 13, color: '#6b7280' }}>Connecting to support...</div>;
  }

  return (
    <ChatWindow
      baseUrl={baseUrl}
      conversationSid={conversationSid}
      identity={sellerEmail}
      onEnd={onEnd}
      compact
    />
  );
}
