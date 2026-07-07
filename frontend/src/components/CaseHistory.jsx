import { useState, useEffect } from 'react';
import ChatWindow from './ChatWindow.jsx';
import EmailThreadView from './EmailThreadView.jsx';

const CHANNELS = ['email', 'phone', 'chat'];

// this is a simplistic (happy path) implementation of a Case History component for demo purposes.
// In a production app, you would likely want to add more robust error handling, loading states, and pagination for large histories.
// also consider how you want to tie together interactions across multiple channels (email, phone, chat) or
// individual interactions that may have multiple threads (e.g. multiple email threads for a single case).
export default function CaseHistory({
  baseUrl,
  caseId,
  sellerName,
  helpCategory,
  sellerEmail,
  refreshTrigger,
  workerIdentity,
}) {
  const [activeTab, setActiveTab] = useState('email');
  const [interactions, setInteractions] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [composingEmail, setComposingEmail] = useState(false);
  const [emailInput, setEmailInput] = useState(sellerEmail || '');
  const [activeEmailConversationSid, setActiveEmailConversationSid] =
    useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!caseId) return;
    fetchInteractions();
  }, [caseId, refreshTrigger]);

  const fetchInteractions = async () => {
    try {
      const res = await fetch(
        `${baseUrl}/get-case-interactions?case_id=${caseId}`,
      );
      const data = await res.json();
      setInteractions(data.interactions || []);
    } catch (err) {
      console.error('Failed to fetch interactions', err);
    }
  };

  const toggleExpand = (id) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const startEmailThread = async () => {
    if (!emailInput.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/create-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seller_name: sellerName,
          help_category: helpCategory,
          channel: 'email',
          seller_email: emailInput.trim(),
        }),
      });
      const data = await res.json();
      if (data.case_id) {
        setComposingEmail(false);
        await fetchInteractions();
      }
    } catch (err) {
      console.error('Failed to start email thread', err);
    } finally {
      setLoading(false);
    }
  };

  const byChannel = (ch) => interactions.filter((i) => i.channel === ch);

  const formatDate = (str) => {
    if (!str) return '';
    return new Date(str).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className='case-history'>
      <div className='case-history-header'>
        <span className='case-history-title'>Case History</span>
        <span className='case-id-chip'>{caseId}</span>
      </div>

      <div className='tab-bar'>
        {CHANNELS.map((ch) => (
          <button
            key={ch}
            className={`tab-btn${activeTab === ch ? ' active' : ''}`}
            onClick={() => setActiveTab(ch)}
          >
            {ch.charAt(0).toUpperCase() + ch.slice(1)}
            {byChannel(ch).length > 0 && (
              <span className='tab-count'>{byChannel(ch).length}</span>
            )}
          </button>
        ))}
      </div>

      <div className='tab-content'>
        {/* EMAIL TAB */}
        {activeTab === 'email' && (
          <div>
            {activeEmailConversationSid ? (
              <EmailThreadView
                baseUrl={baseUrl}
                conversationSid={activeEmailConversationSid}
                identity={workerIdentity}
                sellerEmail={sellerEmail}
                onEnd={() => {
                  setActiveEmailConversationSid(null);
                  fetchInteractions();
                }}
              />
            ) : composingEmail ? (
              <div className='compose-email'>
                <div className='form-group' style={{ marginBottom: 10 }}>
                  <label>Seller Email</label>
                  <input
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder='seller@example.com'
                  />
                </div>
                <div className='btn-row'>
                  <button
                    className='btn btn-primary'
                    onClick={startEmailThread}
                    disabled={loading}
                  >
                    {loading ? 'Starting...' : 'Start Thread'}
                  </button>
                  <button
                    className='btn btn-ghost'
                    onClick={() => setComposingEmail(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <button
                  className='btn btn-primary'
                  style={{ marginBottom: 16 }}
                  onClick={() => setComposingEmail(true)}
                >
                  + New Email Thread
                </button>
                {byChannel('email').length === 0 ? (
                  <div className='empty-state'>No email interactions yet</div>
                ) : (
                  byChannel('email').map((i) => (
                    <InteractionRow
                      key={i.airtable_id}
                      interaction={i}
                      expanded={expanded[i.airtable_id]}
                      onToggle={() => toggleExpand(i.airtable_id)}
                      onResume={() => {
                        setActiveEmailConversationSid(i.conversation_sid);
                      }}
                      formatDate={formatDate}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* PHONE TAB */}
        {activeTab === 'phone' && (
          <div>
            {byChannel('phone').length === 0 ? (
              <div className='empty-state'>No phone interactions yet</div>
            ) : (
              byChannel('phone').map((i) => (
                <div key={i.airtable_id} className='interaction-row'>
                  <div className='interaction-meta'>
                    <span className='interaction-date'>
                      {formatDate(i.created_at)}
                    </span>
                    <span
                      className={`status-badge status-${i.status === 'resolved' ? 'available' : 'busy'}`}
                    >
                      {i.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
                    Called {i.seller_phone || 'unknown'}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* CHAT TAB */}
        {activeTab === 'chat' && (
          <div>
            {byChannel('chat').length === 0 ? (
              <div className='empty-state'>No chat interactions yet</div>
            ) : (
              byChannel('chat').map((i) => (
                <InteractionRow
                  key={i.airtable_id}
                  interaction={i}
                  expanded={expanded[i.airtable_id]}
                  onToggle={() => toggleExpand(i.airtable_id)}
                  formatDate={formatDate}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function InteractionRow({
  interaction: i,
  expanded,
  onToggle,
  onResume,
  formatDate,
}) {
  return (
    <div className='interaction-row'>
      <div
        className='interaction-meta'
        onClick={onToggle}
        style={{ cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className='interaction-date'>{formatDate(i.created_at)}</span>
          <span
            className={`status-badge status-${i.status === 'resolved' ? 'available' : 'busy'}`}
          >
            {i.status}
          </span>
          {i.messages.length > 0 && (
            <span style={{ fontSize: 12, color: '#9ca3af' }}>
              {i.messages.length} messages
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {onResume && i.status === 'wip' && (
            <button
              className='btn btn-ghost'
              style={{ padding: '3px 10px', fontSize: 12 }}
              onClick={(e) => {
                e.stopPropagation();
                onResume();
              }}
            >
              Open
            </button>
          )}
          <span style={{ fontSize: 12, color: '#9ca3af' }}>
            {expanded ? '▲' : '▼'}
          </span>
        </div>
      </div>

      {expanded && i.messages.length > 0 && (
        <div className='transcript'>
          {i.messages.map((m) => (
            <div
              key={m.sid}
              className={`transcript-msg ${m.author === workerIdentity ? 'mine' : 'theirs'}`}
            >
              <div className='transcript-author'>{m.author}</div>
              <div>{m.body}</div>
            </div>
          ))}
        </div>
      )}

      {expanded && i.messages.length === 0 && (
        <div style={{ padding: '8px 0', fontSize: 13, color: '#9ca3af' }}>
          No messages recorded
        </div>
      )}
    </div>
  );
}
