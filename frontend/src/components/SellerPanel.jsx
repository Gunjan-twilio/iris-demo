import { useState, useEffect, useRef } from 'react';
import ChatWindow from './ChatWindow.jsx';

const CHANNEL_LABELS = { chat: 'Chat', email: 'Email', phone: 'Phone' };
const STATUS_COLORS = {
  new: { bg: '#eff6ff', color: '#1d4ed8', label: 'Waiting for associate' },
  wip: { bg: '#fef9c3', color: '#92400e', label: 'In progress' },
  resolved: { bg: '#dcfce7', color: '#15803d', label: 'Resolved' },
};

export default function SellerPanel({ baseUrl }) {
  const [step, setStep] = useState('form'); // 'form' | 'active'
  const [form, setForm] = useState({
    seller_name: '',
    seller_email: '',
    help_category: 'payments',
    channel: 'chat',
    seller_phone: '',
    case_summary: '',
  });
  const [submitting, setSubmitting] = useState(false);

  // Active case state
  const [caseId, setCaseId] = useState(null);
  const [caseData, setCaseData] = useState(null);
  const [conversationSid, setConversationSid] = useState(null);
  const pollRef = useRef(null);

  // History state
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const handleChange = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async e => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(`${baseUrl}/create-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      setCaseId(data.case_id);
      setCaseData({ status: 'new', channel: form.channel, seller_email: form.seller_email, case_summary: form.case_summary });
      setConversationSid(null);
      setStep('active');
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  // Poll active case status
  useEffect(() => {
    if (!caseId || step !== 'active') return;

    const poll = async () => {
      try {
        const res = await fetch(`${baseUrl}/get-case?case_id=${caseId}`);
        const data = await res.json();
        setCaseData(data);
        if (data.conversation_sid && !conversationSid) {
          setConversationSid(data.conversation_sid);
        }
        if (data.status === 'resolved') {
          setConversationSid(null);
          clearInterval(pollRef.current);
          loadHistory(form.seller_email);
        }
      } catch (err) {
        console.error(err);
      }
    };

    pollRef.current = setInterval(poll, 2000);
    return () => clearInterval(pollRef.current);
  }, [caseId, step]);

  const loadHistory = async (email) => {
    if (!email) return;
    setLoadingHistory(true);
    try {
      const res = await fetch(`${baseUrl}/get-seller-cases?seller_email=${encodeURIComponent(email)}`);
      const data = await res.json();
      setHistory(data.cases || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Load history when we go to active view
  useEffect(() => {
    if (step === 'active' && form.seller_email) {
      loadHistory(form.seller_email);
    }
  }, [step]);

  const startNewCase = () => {
    clearInterval(pollRef.current);
    setCaseId(null);
    setCaseData(null);
    setConversationSid(null);
    setForm(f => ({ ...f, case_summary: '', channel: 'chat', seller_phone: '' }));
    setStep('form');
  };

  // ---- FORM ----
  if (step === 'form') {
    return (
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Your Name</label>
          <input
            name="seller_name"
            value={form.seller_name}
            onChange={handleChange}
            placeholder="e.g. Acme Corp"
            required
          />
        </div>
        <div className="form-group">
          <label>Your Email</label>
          <input
            name="seller_email"
            type="email"
            value={form.seller_email}
            onChange={handleChange}
            placeholder="you@example.com"
            required
          />
        </div>
        <div className="form-group">
          <label>Case Summary</label>
          <input
            name="case_summary"
            value={form.case_summary}
            onChange={handleChange}
            placeholder="Briefly describe your issue"
            required
          />
        </div>
        <div className="form-group">
          <label>Help Category</label>
          <select name="help_category" value={form.help_category} onChange={handleChange}>
            <option value="payments">Payments</option>
            <option value="listings">Listings</option>
          </select>
        </div>
        <div className="form-group">
          <label>Contact Channel</label>
          <select name="channel" value={form.channel} onChange={handleChange}>
            <option value="chat">Chat</option>
            <option value="phone">Phone</option>
            <option value="email">Email</option>
          </select>
        </div>
        {form.channel === 'phone' && (
          <div className="form-group">
            <label>Your Phone Number</label>
            <input
              name="seller_phone"
              value={form.seller_phone}
              onChange={handleChange}
              placeholder="+1xxxxxxxxxx"
              required
            />
          </div>
        )}
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Submitting...' : 'Submit Case'}
        </button>
      </form>
    );
  }

  // ---- ACTIVE CASE + HISTORY ----
  const status = caseData?.status || 'new';
  const channel = caseData?.channel || form.channel;
  const subject = `[${caseId}] ${caseData?.case_summary || form.case_summary}`;
  const sc = STATUS_COLORS[status] || STATUS_COLORS.new;

  // Cases in history excluding the one currently open
  const pastCases = history.filter(c => c.case_id !== caseId);

  return (
    <div>
      {/* Active case header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <span style={{ fontSize: 12, color: '#6b7280' }}>Case ID</span>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{caseId}</div>
        </div>
        <button className="btn btn-primary" style={{ fontSize: 13, padding: '6px 14px' }} onClick={startNewCase}>
          + New Case
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: sc.bg, color: sc.color }}>
          {sc.label}
        </span>
        <span style={{ fontSize: 12, color: '#9ca3af' }}>{CHANNEL_LABELS[channel]}</span>
      </div>

      {/* Channel-specific active case content */}
      {channel === 'chat' && !conversationSid && status !== 'resolved' && (
        <div className="waiting">Connecting you to an associate via chat...</div>
      )}
      {channel === 'chat' && conversationSid && (
        <ChatWindow
          baseUrl={baseUrl}
          conversationSid={conversationSid}
          identity={`seller-${caseId}`}
        />
      )}
      {channel === 'chat' && status === 'resolved' && !conversationSid && (
        <div className="waiting" style={{ background: '#dcfce7', color: '#15803d' }}>
          Your case has been resolved. Thank you!
        </div>
      )}

      {channel === 'email' && status !== 'resolved' && (
        <div className="waiting">
          Your case has been submitted. An associate will respond to you at <strong>{caseData?.seller_email || form.seller_email}</strong>.
        </div>
      )}
      {channel === 'email' && status === 'resolved' && (
        <div className="waiting" style={{ background: '#dcfce7', color: '#15803d' }}>
          Your case has been resolved. Thank you!
        </div>
      )}

      {channel === 'phone' && (
        <div className="waiting">
          An associate will call you back shortly at {form.seller_phone}.
        </div>
      )}

      {/* Case history */}
      {(loadingHistory || pastCases.length > 0) && (
        <>
          <hr className="divider" />
          <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 10 }}>
            Previous Cases
          </div>
          {loadingHistory && <div style={{ fontSize: 13, color: '#9ca3af' }}>Loading...</div>}
          {pastCases.map(c => {
            const csc = STATUS_COLORS[c.status] || STATUS_COLORS.new;
            return (
              <div key={c.case_id} className="interaction-row">
                <div className="interaction-meta">
                  <div>
                    <span className="case-id-chip">{c.case_id}</span>
                    <span style={{ fontSize: 13, marginLeft: 8, color: '#374151' }}>{c.case_summary || '—'}</span>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: csc.bg, color: csc.color }}>
                    {csc.label}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
                  {CHANNEL_LABELS[c.channel] || c.channel} · {c.help_category}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
