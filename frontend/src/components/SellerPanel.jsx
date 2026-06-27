import { useState, useEffect, useRef } from 'react';
import ChatWindow from './ChatWindow.jsx';

const CHANNEL_LABELS = { chat: 'Chat', email: 'Email', phone: 'Phone' };
const STATUS = {
  new:      { bg: '#EBF5FB', color: '#1565C0', label: 'Waiting' },
  wip:      { bg: '#FFF8E1', color: '#E65100', label: 'In Progress' },
  resolved: { bg: '#E8F5E9', color: '#2E7D32', label: 'Resolved' },
};

const NAV_ITEMS = ['Home','Catalog','Pricing','Orders','Payments','Performance','Analytics','Growth','Advertising','Reports','Apps'];

function WalmartBackdrop({ sellerName }) {
  return (
    <div className="wmt-layout">
      <aside className="wmt-nav">
        <div className="wmt-nav-brand">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="#FFC220"><polygon points="12,2 15,9 22,9 17,14 19,21 12,17 5,21 7,14 2,9 9,9"/></svg>
          <span>Seller Center</span>
        </div>
        {NAV_ITEMS.map(item => (
          <div key={item} className={`wmt-nav-item${item === 'Home' ? ' active' : ''}`}>{item}</div>
        ))}
      </aside>
      <div className="wmt-main">
        <header className="wmt-header">
          <div className="wmt-search">
            <svg width="14" height="14" fill="none" stroke="#9ca3af" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input placeholder="Try searching for Order" readOnly />
          </div>
        </header>
        <div className="wmt-content">
          <h2 className="wmt-welcome">Welcome to Seller Center{sellerName ? `, ${sellerName}` : ''}</h2>
          <div className="wmt-metrics-row">
            {[["Today's Sales", "$0"], ["Unpaid Orders", "0"], ["Account Health", "2.76"]].map(([label, val]) => (
              <div key={label} className="wmt-metric">
                <div className="wmt-metric-label">{label} <span style={{color:'#9ca3af',fontSize:10}}>ⓘ</span></div>
                <div className="wmt-metric-val">{val}</div>
              </div>
            ))}
          </div>
          <div className="wmt-promo-card">
            <div>
              <strong style={{fontSize:14,display:'block',marginBottom:6,color:'#1a1a2e'}}>Gain a competitive edge</strong>
              <p style={{fontSize:12,color:'#6b7280',lineHeight:1.5,marginBottom:12}}>Use the Assortment Growth tool to view popular items, demand and price trends, and competitive insights.</p>
              <button className="wmt-btn-explore">Explore</button>
            </div>
            <div style={{fontSize:36,marginLeft:20,opacity:0.6}}>📊</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SellerPanel({ baseUrl }) {
  const [seller, setSeller] = useState(null);
  const [loginForm, setLoginForm] = useState({ seller_name: '', seller_email: '' });
  const [view, setView] = useState('home'); // 'home' | 'new-case' | 'cases' | 'case-detail'
  const [cases, setCases] = useState([]);
  const [loadingCases, setLoadingCases] = useState(false);
  const [activeCase, setActiveCase] = useState(null);
  const [conversationSid, setConversationSid] = useState(null);
  const [newCaseForm, setNewCaseForm] = useState({ help_category: 'payments', channel: 'chat', seller_phone: '', case_summary: '' });
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef(null);

  const loadCases = async (email) => {
    if (!email) return;
    setLoadingCases(true);
    try {
      const res = await fetch(`${baseUrl}/get-seller-cases?seller_email=${encodeURIComponent(email)}`);
      const data = await res.json();
      setCases(data.cases || []);
    } catch (e) { console.error(e); }
    finally { setLoadingCases(false); }
  };

  const handleLogin = (e) => {
    e.preventDefault();
    const s = { name: loginForm.seller_name, email: loginForm.seller_email };
    setSeller(s);
    loadCases(s.email);
  };

  // Poll when viewing a case detail
  useEffect(() => {
    if (view !== 'case-detail' || !activeCase) return;
    clearInterval(pollRef.current);
    const poll = async () => {
      try {
        const res = await fetch(`${baseUrl}/get-case?case_id=${activeCase.case_id}`);
        const data = await res.json();
        setActiveCase(data);
        if (data.conversation_sid) setConversationSid(data.conversation_sid);
        setCases(prev => prev.map(c => c.case_id === data.case_id ? { ...c, ...data } : c));
      } catch (e) { console.error(e); }
    };
    poll();
    pollRef.current = setInterval(poll, 3000);
    return () => clearInterval(pollRef.current);
  }, [view, activeCase?.case_id]);

  const openCase = (c) => {
    setActiveCase(c);
    setConversationSid(c.conversation_sid || null);
    setView('case-detail');
  };

  const handleNewCaseSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(`${baseUrl}/create-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seller_name: seller.name, seller_email: seller.email, ...newCaseForm }),
      });
      const data = await res.json();
      const newCase = {
        case_id: data.case_id,
        status: 'new',
        channel: newCaseForm.channel,
        help_category: newCaseForm.help_category,
        case_summary: newCaseForm.case_summary,
        seller_email: seller.email,
        seller_name: seller.name,
        seller_phone: newCaseForm.seller_phone,
        conversation_sid: data.conversation_sid || '',
      };
      setCases(prev => [newCase, ...prev]);
      setNewCaseForm({ help_category: 'payments', channel: 'chat', seller_phone: '', case_summary: '' });
      openCase(newCase);
    } catch (e) { console.error(e); }
    finally { setSubmitting(false); }
  };

  const handleResolve = async () => {
    if (!activeCase) return;
    try {
      await fetch(`${baseUrl}/resolve-case`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: activeCase.case_id, resolve: true }),
      });
      const updated = { ...activeCase, status: 'resolved' };
      setActiveCase(updated);
      setCases(prev => prev.map(c => c.case_id === activeCase.case_id ? updated : c));
      clearInterval(pollRef.current);
    } catch (e) { console.error(e); }
  };

  const goHome = () => { clearInterval(pollRef.current); setView('home'); };
  const goCases = () => { clearInterval(pollRef.current); loadCases(seller.email); setView('cases'); };

  const renderPanel = () => {
    // LOGIN
    if (!seller) {
      return (
        <>
          <div className="iris-greeting">
            <div className="iris-avatar">M</div>
            <div>
              <div style={{fontWeight:600,fontSize:14}}>Hi, I'm IRIS</div>
              <div style={{fontSize:12,color:'#6b7280',marginTop:2}}>Your Walmart seller support assistant</div>
            </div>
          </div>
          <form onSubmit={handleLogin} style={{marginTop:16}}>
            <div className="form-group">
              <label>Your Name</label>
              <input value={loginForm.seller_name} onChange={e => setLoginForm(f=>({...f,seller_name:e.target.value}))} placeholder="e.g. Acme Corp" required />
            </div>
            <div className="form-group">
              <label>Your Email</label>
              <input type="email" value={loginForm.seller_email} onChange={e => setLoginForm(f=>({...f,seller_email:e.target.value}))} placeholder="you@example.com" required />
            </div>
            <button type="submit" className="iris-btn-primary">Continue</button>
          </form>
        </>
      );
    }

    // HOME
    if (view === 'home') {
      const openCount = cases.filter(c => c.status !== 'resolved').length;
      return (
        <>
          <div className="iris-greeting">
            <div className="iris-avatar">M</div>
            <div>
              <div style={{fontWeight:600,fontSize:14}}>Hi {seller.name.split(' ')[0]}, I'm IRIS</div>
              <div style={{fontSize:12,color:'#6b7280',marginTop:2}}>Smart Assistant — here when you need it.</div>
            </div>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:8,marginTop:4}}>
            <button className="iris-option-row" onClick={() => setView('new-case')}>
              <span className="iris-option-icon">✦</span>
              <div style={{flex:1}}>
                <div className="iris-option-label">Contact support</div>
                <div className="iris-option-sub">Get help from our Support team</div>
              </div>
              <span className="iris-chevron">›</span>
            </button>
            <button className="iris-option-row" onClick={goCases}>
              <span className="iris-option-icon">📋</span>
              <div style={{flex:1}}>
                <div className="iris-option-label">Your cases</div>
                <div className="iris-option-sub">Review and take action on open cases</div>
              </div>
              {openCount > 0 && <span className="iris-badge-count">{openCount}</span>}
              <span className="iris-chevron">›</span>
            </button>
          </div>
        </>
      );
    }

    // CASES LIST
    if (view === 'cases') {
      return (
        <>
          <div className="iris-view-header">
            <button className="iris-back-btn" onClick={goHome}>← Back</button>
            <span className="iris-view-title">Your Cases</span>
            <button className="iris-btn-sm" onClick={() => setView('new-case')}>+ New</button>
          </div>
          {loadingCases && <div className="empty-state">Loading...</div>}
          {!loadingCases && cases.length === 0 && <div className="empty-state" style={{paddingTop:32}}>No cases yet.</div>}
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {cases.map(c => {
              const st = STATUS[c.status] || STATUS.new;
              return (
                <button key={c.case_id} className="iris-case-row" onClick={() => openCase(c)}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                    <span className="iris-case-id-chip">{c.case_id}</span>
                    <span className="iris-status-chip" style={{background:st.bg,color:st.color}}>{st.label}</span>
                  </div>
                  <div style={{fontSize:13,color:'#374151',fontWeight:500,marginBottom:3}}>{c.case_summary || '—'}</div>
                  <div style={{fontSize:12,color:'#9ca3af'}}>{CHANNEL_LABELS[c.channel] || c.channel} · {c.help_category}</div>
                </button>
              );
            })}
          </div>
        </>
      );
    }

    // NEW CASE
    if (view === 'new-case') {
      return (
        <>
          <div className="iris-view-header">
            <button className="iris-back-btn" onClick={goHome}>← Back</button>
            <span className="iris-view-title">Contact Support</span>
          </div>
          <form onSubmit={handleNewCaseSubmit}>
            <div className="form-group">
              <label>Case Summary</label>
              <input value={newCaseForm.case_summary} onChange={e => setNewCaseForm(f=>({...f,case_summary:e.target.value}))} placeholder="Briefly describe your issue" required />
            </div>
            <div className="form-group">
              <label>Help Category</label>
              <select value={newCaseForm.help_category} onChange={e => setNewCaseForm(f=>({...f,help_category:e.target.value}))}>
                <option value="payments">Payments</option>
                <option value="listings">Listings</option>
              </select>
            </div>
            <div className="form-group">
              <label>Contact Channel</label>
              <select value={newCaseForm.channel} onChange={e => setNewCaseForm(f=>({...f,channel:e.target.value}))}>
                <option value="chat">Chat</option>
                <option value="phone">Phone Callback</option>
                <option value="email">Email</option>
              </select>
            </div>
            {newCaseForm.channel === 'phone' && (
              <div className="form-group">
                <label>Your Phone Number</label>
                <input value={newCaseForm.seller_phone} onChange={e => setNewCaseForm(f=>({...f,seller_phone:e.target.value}))} placeholder="+1xxxxxxxxxx" required />
              </div>
            )}
            <button type="submit" className="iris-btn-primary" disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit Case'}
            </button>
          </form>
        </>
      );
    }

    // CASE DETAIL
    if (view === 'case-detail' && activeCase) {
      const st = STATUS[activeCase.status] || STATUS.new;
      const channel = activeCase.channel;
      const isResolved = activeCase.status === 'resolved';

      return (
        <>
          <div className="iris-view-header">
            <button className="iris-back-btn" onClick={goCases}>← Cases</button>
            <span className="iris-view-title">Case Detail</span>
          </div>

          <div className="iris-case-meta-card">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
              <span className="iris-case-id-chip">{activeCase.case_id}</span>
              <span className="iris-status-chip" style={{background:st.bg,color:st.color}}>{st.label}</span>
            </div>
            <div style={{fontSize:13,fontWeight:500,color:'#1a1a2e',marginBottom:4}}>{activeCase.case_summary}</div>
            <div style={{fontSize:12,color:'#9ca3af'}}>{CHANNEL_LABELS[channel]} · {activeCase.help_category}</div>
          </div>

          {channel === 'chat' && !conversationSid && !isResolved && (
            <div className="iris-status-msg">Connecting you to an associate via chat...</div>
          )}
          {channel === 'chat' && conversationSid && !isResolved && (
            <ChatWindow baseUrl={baseUrl} conversationSid={conversationSid} identity={seller.email} compact />
          )}
          {channel === 'email' && !isResolved && (
            <div className="iris-status-msg">An associate will respond to <strong>{seller.email}</strong></div>
          )}
          {channel === 'phone' && !isResolved && (
            <div className="iris-status-msg">An associate will call you at <strong>{activeCase.seller_phone}</strong></div>
          )}
          {isResolved && (
            <div className="iris-status-msg iris-status-resolved">✓ This case has been resolved. Thank you!</div>
          )}

          {!isResolved && (
            <button className="iris-btn-resolve" onClick={handleResolve}>Mark as Resolved</button>
          )}
        </>
      );
    }
  };

  return (
    <div className="wmt-full">
      <WalmartBackdrop sellerName={seller?.name} />
      <div className="iris-panel">
        <div className="iris-panel-header">
          <div className="iris-panel-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#0071CE"><polygon points="12,2 15,9 22,9 17,14 19,21 12,17 5,21 7,14 2,9 9,9"/></svg>
            Help
          </div>
          {seller && view !== 'home' && (
            <button className="iris-home-link" onClick={goHome}>Home</button>
          )}
        </div>
        <div className="iris-panel-body">
          {renderPanel()}
        </div>
      </div>
    </div>
  );
}
