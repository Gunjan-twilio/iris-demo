import { useState, useEffect, useRef } from 'react';
import ChatWindow from './ChatWindow.jsx';
import EmailThreadView from './EmailThreadView.jsx';

export default function SellerPanel({ baseUrl }) {
  const [form, setForm] = useState({
    seller_name: '',
    help_category: 'payments',
    channel: 'chat',
    seller_phone: '',
    seller_email: '',
    case_summary: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [caseId, setCaseId] = useState(null);
  const [caseData, setCaseData] = useState(null);
  const [conversationSid, setConversationSid] = useState(null);
  const pollRef = useRef(null);

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
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!caseId) return;

    pollRef.current = setInterval(async () => {
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
        }
      } catch (err) {
        console.error(err);
      }
    }, 2000);

    return () => clearInterval(pollRef.current);
  }, [caseId]);

  if (!caseId) {
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
        {form.channel === 'email' && (
          <div className="form-group">
            <label>Your Email Address</label>
            <input
              name="seller_email"
              value={form.seller_email}
              onChange={handleChange}
              placeholder="you@example.com"
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

  const status = caseData?.status;
  const channel = caseData?.channel || form.channel;
  const subject = `[${caseId}] ${caseData?.case_summary || form.case_summary}`;

  return (
    <div>
      <p style={{ fontSize: 13, color: '#6b7280' }}>Case ID</p>
      <p style={{ fontWeight: 600, marginBottom: 4 }}>{caseId}</p>
      <span className={`status-badge status-${status === 'wip' ? 'available' : 'offline'}`}>
        {status === 'new' ? 'Waiting for associate...' : status}
      </span>

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
          Your case has been resolved. Thank you for contacting support.
        </div>
      )}

      {channel === 'email' && status !== 'resolved' && (
        conversationSid
          ? <EmailThreadView
              baseUrl={baseUrl}
              conversationSid={conversationSid}
              identity={`seller-${caseId}`}
              caseId={caseId}
              subject={subject}
              sellerEmail={caseData?.seller_email || form.seller_email}
            />
          : <div className="waiting">Waiting for associate — you'll also receive updates at {caseData?.seller_email || form.seller_email}</div>
      )}

      {channel === 'email' && status === 'resolved' && (
        <div className="waiting" style={{ background: '#dcfce7', color: '#15803d' }}>
          Your case has been resolved. Thank you for contacting support.
        </div>
      )}

      {channel === 'phone' && (
        <div className="waiting">
          An associate will call you back shortly at {form.seller_phone}.
        </div>
      )}
    </div>
  );
}
