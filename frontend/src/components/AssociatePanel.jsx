import { useEffect, useState, useRef } from 'react';
import {
  AcceptTask,
  RejectTask,
  EndTask,
  CompleteTask,
  SetCurrentActivity,
} from '@twilio/flex-sdk';
import { StartOutboundCall } from '@twilio/flex-sdk/actions/Voice';
import ChatWindow from './ChatWindow.jsx';
import EmailThreadView from './EmailThreadView.jsx';
import PhoneControls from './PhoneControls.jsx';

const STATUS = {
  new:      { bg: '#EBF5FB', color: '#1565C0', label: 'Waiting' },
  wip:      { bg: '#FFF8E1', color: '#E65100', label: 'In Progress' },
  resolved: { bg: '#E8F5E9', color: '#2E7D32', label: 'Resolved' },
};
const CHANNEL_ICON = { email: '✉', chat: '💬', phone: '📞' };

export default function AssociatePanel({ baseUrl, flexClient }) {
  const [worker, setWorker] = useState(null);
  const [activity, setActivity] = useState('Offline');
  const [showStatusMenu, setShowStatusMenu] = useState(false);

  // Open case tabs
  const [openCases, setOpenCases] = useState([]); // [{case_id, attrs, reservation, voiceCall, ...}]
  const [activeTabId, setActiveTabId] = useState('home');

  // Pending reservation overlay
  const [pendingReservation, setPendingReservation] = useState(null);
  const [pendingAttrs, setPendingAttrs] = useState(null);
  const [countdown, setCountdown] = useState(20);
  const countdownRef = useRef(null);

  // Queue + recent
  const [queueCount, setQueueCount] = useState(0);
  const [recentCases, setRecentCases] = useState([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Phone call state per case
  const [activeCalls, setActiveCalls] = useState({}); // { case_id: VoiceCall }
  const [placeholderTasks, setPlaceholderTasks] = useState({}); // { case_id: taskSid }
  const isDialingRef = useRef(false);
  const openCasesRef = useRef([]);

  const loadRecentCases = async () => {
    setLoadingRecent(true);
    try {
      const res = await fetch(`${baseUrl}/get-associate-cases`);
      const data = await res.json();
      setRecentCases(data.cases || []);
    } catch (e) { console.error(e); }
    finally { setLoadingRecent(false); }
  };

  const pollQueue = async () => {
    try {
      const res = await fetch(`${baseUrl}/get-queue-count`);
      const data = await res.json();
      setQueueCount(data.count || 0);
    } catch (_) {}
  };

  useEffect(() => {
    openCasesRef.current = openCases;
  }, [openCases]);

  useEffect(() => {
    loadRecentCases();
    pollQueue();
    const t = setInterval(pollQueue, 10000);
    return () => clearInterval(t);
  }, []);

  // Init Flex SDK
  useEffect(() => {
    if (!flexClient) return;
    let mounted = true;

    const attachReservationListeners = (res) => {
      res.on('accepted', updated => {
        setPendingReservation(null);
        const attrs = updated.task.attributes;
        setOpenCases(prev => {
          if (prev.find(c => c.case_id === attrs.case_id)) return prev;
          return [...prev, { case_id: attrs.case_id, attrs, reservation: updated, taskSid: updated.task.sid }];
        });
        setActiveTabId(attrs.case_id);
        loadRecentCases();
      });
      res.on('completed', () => {
        const caseId = res.task.attributes?.case_id;
        if (caseId) setOpenCases(prev => prev.filter(c => c.case_id !== caseId));
        loadRecentCases();
      });
      res.on('canceled', () => setPendingReservation(null));
      res.on('rescinded', () => setPendingReservation(null));
      res.on('timeout', () => setPendingReservation(null));
      res.on('rejected', () => { setPendingReservation(null); setPendingAttrs(null); });
    };

    const handleReservation = (res) => {
      const attrs = res.task.attributes || {};
      console.log('[Reservation Event Execution]', res.status, attrs.case_id);

      if (res.status !== 'pending') return;

      // Explicitly target outbound voice tasks created by this CRM via StartOutboundCall
      if (attrs.direction === 'outbound' || attrs.originating_case) {
        console.log('[Silent Audio Monitor] Tracking outbound voice lifecycle for Task:', res.task.sid);
        res.on('wrapup', () => {
          console.log('[Auto-Wrapup Triggered] Completing outbound voice leg:', res.task.sid);
          flexClient.execute(new CompleteTask(res.task.sid)).catch(e => console.warn('Automatic wrapup clearance failed:', e.message));
        });
        return;
      }

      attachReservationListeners(res);
      setPendingReservation(res);
      setPendingAttrs(attrs);
      setCountdown(20);
    };

    const init = async () => {
      const w = await flexClient.getWorker();
      if (!mounted) return;
      setWorker(w);
      setActivity(w.activity.name);
      Array.from(w.reservations.values()).forEach(handleReservation);
      w.on('activityUpdated', u => setActivity(u.activity.name));
      w.on('reservationCreated', handleReservation);
    };

    init().catch(console.error);

    // Restore active case from Airtable on refresh
    fetch(`${baseUrl}/get-active-case`)
      .then(r => r.json())
      .then(data => {
        if (!data.case || !mounted) return;
        const c = data.case;
        setOpenCases(prev => {
          if (prev.find(x => x.case_id === c.case_id)) return prev;
          return [...prev, {
            case_id: c.case_id,
            attrs: {
              case_id: c.case_id, channel: c.channel, seller_name: c.seller_name,
              seller_email: c.seller_email, seller_phone: c.seller_phone,
              help_category: c.help_category, case_summary: c.case_summary || '',
              conversationSid: c.conversation_sid || '', conversation_sid: c.conversation_sid || '',
              task_sid: c.task_sid || '',
            },
            taskSid: c.task_sid || null,
            restored: true,
          }];
        });
      })
      .catch(console.error);

    return () => { mounted = false; };
  }, [flexClient]);

  // Countdown timer for pending reservation
  useEffect(() => {
    if (!pendingReservation) { clearInterval(countdownRef.current); return; }
    const res = pendingReservation;
    countdownRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(countdownRef.current);
          flexClient?.execute(new RejectTask(res.task.sid)).catch(console.error);
          setPendingReservation(null);
          setPendingAttrs(null);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(countdownRef.current);
  }, [pendingReservation]);

  const setAgentActivity = async (name) => {
    if (!worker) return;
    const act = Array.from(worker.activities.values()).find(a => a.name === name);
    if (act) await flexClient.execute(new SetCurrentActivity(act.sid));
    setShowStatusMenu(false);
  };

  const handleAccept = async () => {
    clearInterval(countdownRef.current);
    if (!pendingReservation) return;

    const channel = pendingAttrs?.channel;
    const currentTask = pendingReservation.task;
    const taskSid = currentTask.sid;

    try {
      // Accept the task — 48917 conference errors are expected for non-voice tasks
      try {
        await flexClient.execute(new AcceptTask(taskSid));
      } catch (err) {
        if (err.message?.includes('conference') || err.code === 48917) {
          console.warn('[Bypassed Non-Critical Exception] Handled media race condition.');
        } else {
          throw err;
        }
      }

      await fetch(`${baseUrl}/accept-reservation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_sid: taskSid,
          reservation_sid: pendingReservation.sid,
          channel,
          seller_phone: pendingAttrs?.seller_phone || '',
          seller_email: pendingAttrs?.seller_email || '',
          case_id: pendingAttrs?.case_id,
          conversation_sid: pendingAttrs?.conversationSid || pendingAttrs?.conversation_sid || '',
        }),
      });

      if (channel === 'chat') {
        const initRes = await fetch(`${baseUrl}/initialize-accepted-chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskSid,
            sellerEmail: pendingAttrs?.seller_email || '',
            associateIdentity: 'associate1',
            caseId: pendingAttrs?.case_id,
          }),
        });
        const { conversationSid } = await initRes.json();
        const attrs = { ...pendingAttrs, conversationSid };
        setOpenCases(prev => {
          const exists = prev.find(c => c.case_id === attrs.case_id);
          if (exists) {
            return prev.map(c => c.case_id === attrs.case_id
              ? { ...c, attrs: { ...c.attrs, conversationSid }, taskSid }
              : c
            );
          }
          return [...prev, { case_id: attrs.case_id, attrs, taskSid }];
        });
        setActiveTabId(attrs.case_id);
        setPendingReservation(null);
        setPendingAttrs(null);
        return;
      }

      if (channel === 'phone') {
        const sellerPhone = pendingAttrs?.seller_phone;
        if (sellerPhone) {
          if (isDialingRef.current) return;
          isDialingRef.current = true;
          console.log('--- TRIGGERING DIAL ---');
          try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
            const voiceCall = await flexClient.execute(new StartOutboundCall(sellerPhone, {
              fromNumber: import.meta.env.VITE_TWILIO_PHONE_NUMBER,
              workflowSid: currentTask.workflowSid,
              taskQueueSid: currentTask.queueSid,
              attributesForTaskCreation: {
                direction: 'outbound',
                originating_case: pendingAttrs?.case_id,
                channel: 'phone',
              },
            }));
            const caseId = pendingAttrs?.case_id;
            setActiveCalls(prev => ({ ...prev, [caseId]: voiceCall }));
            setPlaceholderTasks(prev => ({ ...prev, [caseId]: taskSid }));
            await flexClient.execute(new CompleteTask(taskSid)).catch(e => console.warn('[CompleteTask placeholder]', e.message));
          } finally {
            isDialingRef.current = false;
          }
        }
      }
    } catch (err) {
      isDialingRef.current = false;
      console.error('Unified Acceptance Sequence Failed:', err);
    }
  };

  const handleReject = async () => {
    clearInterval(countdownRef.current);
    if (!pendingReservation) return;
    try { await flexClient.execute(new RejectTask(pendingReservation.task.sid)); } catch (e) { console.error(e); }
    setPendingReservation(null);
    setPendingAttrs(null);
  };

  const closeCase = async (caseId, resolve = false) => {
    const c = openCases.find(x => x.case_id === caseId);
    if (c?.taskSid) {
      try { await flexClient.execute(new EndTask(c.taskSid)); } catch (e) { console.warn(e); }
    }
    const ptSid = placeholderTasks[caseId];
    if (ptSid) {
      try { await flexClient.execute(new CompleteTask(ptSid)); } catch (e) { console.warn(e); }
    }
    if (c?.attrs?.case_id) {
      await fetch(`${baseUrl}/resolve-case`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: c.attrs.case_id, resolve }),
      }).catch(console.error);
    }
    setOpenCases(prev => prev.filter(x => x.case_id !== caseId));
    setActiveCalls(prev => { const n = {...prev}; delete n[caseId]; return n; });
    setPlaceholderTasks(prev => { const n = {...prev}; delete n[caseId]; return n; });
    if (activeTabId === caseId) setActiveTabId('home');
    loadRecentCases();
  };

  const activeCase = openCases.find(c => c.case_id === activeTabId);
  const activeCasesCount = openCases.length;
  const resolvedCount = recentCases.filter(c => c.status === 'resolved').length;
  const filteredRecent = recentCases.filter(c =>
    !searchQuery || c.case_id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.seller_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.case_summary?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="iris-assoc-app" onClick={() => showStatusMenu && setShowStatusMenu(false)}>
      {/* TOP NAV */}
      <div className="iris-assoc-nav">
        <div className="iris-assoc-nav-left">
          <div className="iris-assoc-logo">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#0071CE"><polygon points="12,2 15,9 22,9 17,14 19,21 12,17 5,21 7,14 2,9 9,9"/></svg>
            IRIS
          </div>
          <button
            className={`iris-assoc-tab${activeTabId === 'home' ? ' active' : ''}`}
            onClick={() => setActiveTabId('home')}
          >
            Home
          </button>
          {openCases.map(c => (
            <button
              key={c.case_id}
              className={`iris-assoc-tab${activeTabId === c.case_id ? ' active' : ''}`}
              onClick={() => setActiveTabId(c.case_id)}
            >
              <span style={{marginRight:4}}>{CHANNEL_ICON[c.attrs?.channel]}</span>
              {c.case_id}
              <span
                className="iris-assoc-tab-close"
                onClick={e => { e.stopPropagation(); closeCase(c.case_id, false); }}
              >×</span>
            </button>
          ))}
        </div>
        <div className="iris-assoc-nav-right">
          {!flexClient && <span style={{fontSize:12,color:'#9ca3af',marginRight:12}}>Connecting...</span>}
          <div style={{position:'relative'}}>
            <button
              className="iris-assoc-status-btn"
              onClick={e => { e.stopPropagation(); setShowStatusMenu(s => !s); }}
            >
              <span className={`iris-assoc-dot ${activity === 'Available' ? 'dot-green' : 'dot-gray'}`} />
              {activity}
              <span style={{marginLeft:4,fontSize:10}}>▾</span>
            </button>
            {showStatusMenu && (
              <div className="iris-assoc-status-menu">
                <div className="iris-assoc-status-label">Agent status</div>
                {['Offline','Available'].map(name => (
                  <div
                    key={name}
                    className={`iris-assoc-status-option${activity === name ? ' selected' : ''}`}
                    onClick={() => setAgentActivity(name)}
                  >
                    <span className={`iris-assoc-dot ${name === 'Available' ? 'dot-green' : 'dot-gray'}`} />
                    {name}
                    {activity === name && <span style={{marginLeft:'auto',color:'#0071CE'}}>✓</span>}
                  </div>
                ))}
                <div className="iris-assoc-status-set-btn" onClick={() => setShowStatusMenu(false)}>Set status</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ACCEPT / REJECT OVERLAY */}
      {pendingReservation && pendingAttrs && (
        <div className="iris-overlay-backdrop">
          <div className="iris-overlay-card">
            <div className="iris-overlay-header">
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontSize:20}}>{CHANNEL_ICON[pendingAttrs.channel]}</span>
                <div>
                  <div style={{fontWeight:700,fontSize:15}}>Incoming {pendingAttrs.channel} case</div>
                  <div style={{fontSize:12,color:'#6b7280',marginTop:2}}>{pendingAttrs.case_id}</div>
                </div>
              </div>
              <div className="iris-overlay-countdown">{countdown}s</div>
            </div>
            <div className="iris-overlay-body">
              <div className="iris-overlay-row"><span>Seller</span><strong>{pendingAttrs.seller_name}</strong></div>
              <div className="iris-overlay-row"><span>Category</span><strong>{pendingAttrs.help_category}</strong></div>
              {pendingAttrs.case_summary && <div className="iris-overlay-row"><span>Issue</span><strong>{pendingAttrs.case_summary}</strong></div>}
              {pendingAttrs.seller_email && <div className="iris-overlay-row"><span>Email</span><strong>{pendingAttrs.seller_email}</strong></div>}
              {pendingAttrs.seller_phone && <div className="iris-overlay-row"><span>Phone</span><strong>{pendingAttrs.seller_phone}</strong></div>}
            </div>
            <div className="iris-overlay-actions">
              <button className="iris-overlay-accept" onClick={handleAccept}>Accept</button>
              <button className="iris-overlay-reject" onClick={handleReject}>Reject</button>
            </div>
          </div>
        </div>
      )}

      {/* HOME VIEW */}
      {activeTabId === 'home' && (
        <div className="iris-assoc-home">
          <div className="iris-assoc-home-main">
            <h1 className="iris-assoc-home-title">Manage my cases</h1>
            <p className="iris-assoc-home-sub">Work on your active cases and review case history from the past 30 days.</p>

            <div className="iris-assoc-section-title">Active cases</div>
            {activeCasesCount === 0 ? (
              <div className="iris-assoc-empty">
                <div style={{fontSize:40,marginBottom:12,opacity:0.3}}>📋</div>
                <div style={{fontWeight:500,color:'#374151',marginBottom:4}}>No active cases yet</div>
                <div style={{fontSize:13,color:'#9ca3af'}}>As soon as you have one, you will see your assigned cases here.</div>
              </div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {openCases.map(c => {
                  const st = STATUS[c.attrs?.status || 'wip'] || STATUS.wip;
                  return (
                    <div key={c.case_id} className="iris-assoc-case-card" onClick={() => setActiveTabId(c.case_id)}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          <span style={{fontSize:18}}>{CHANNEL_ICON[c.attrs?.channel]}</span>
                          <div>
                            <div style={{fontWeight:600,fontSize:14,color:'#1a1a2e'}}>{c.case_id}</div>
                            <div style={{fontSize:12,color:'#6b7280',marginTop:2}}>{c.attrs?.seller_name} · {c.attrs?.help_category}</div>
                          </div>
                        </div>
                        <span className="iris-status-chip" style={{background:st.bg,color:st.color}}>{st.label}</span>
                      </div>
                      {c.attrs?.case_summary && <div style={{fontSize:13,color:'#374151',marginTop:8}}>{c.attrs.case_summary}</div>}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="iris-assoc-section-title" style={{marginTop:32}}>Recent cases</div>
            <div className="iris-assoc-metrics-row">
              <div className="iris-assoc-metric">
                <div className="iris-assoc-metric-icon">✉</div>
                <div>
                  <div className="iris-assoc-metric-val">{resolvedCount}</div>
                  <div className="iris-assoc-metric-label">Resolved</div>
                </div>
              </div>
              <div className="iris-assoc-metric">
                <div className="iris-assoc-metric-icon">↩</div>
                <div>
                  <div className="iris-assoc-metric-val">0</div>
                  <div className="iris-assoc-metric-label">Reopen</div>
                </div>
              </div>
              <div className="iris-assoc-metric">
                <div className="iris-assoc-metric-icon">★</div>
                <div>
                  <div className="iris-assoc-metric-val">0</div>
                  <div className="iris-assoc-metric-label">Satisfaction</div>
                </div>
              </div>
            </div>
            <div className="iris-assoc-search-row">
              <input
                className="iris-assoc-search"
                placeholder="Search by Case Number (min 3 characters)"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            <div style={{marginTop:12,display:'flex',flexDirection:'column',gap:8}}>
              {loadingRecent && <div className="empty-state">Loading...</div>}
              {!loadingRecent && filteredRecent.length === 0 && <div className="empty-state">No recent cases.</div>}
              {filteredRecent.map(c => {
                const st = STATUS[c.status] || STATUS.new;
                return (
                  <div key={c.case_id} className="iris-assoc-recent-row" onClick={() => {
                    setOpenCases(prev => {
                      if (prev.find(x => x.case_id === c.case_id)) return prev;
                      return [...prev, { case_id: c.case_id, attrs: { ...c, conversationSid: c.conversation_sid }, taskSid: c.task_sid, restored: true }];
                    });
                    setActiveTabId(c.case_id);
                  }}>
                    <div style={{display:'flex',alignItems:'center',gap:10,flex:1}}>
                      <span>{CHANNEL_ICON[c.channel]}</span>
                      <div>
                        <span className="iris-case-id-chip">{c.case_id}</span>
                        <span style={{fontSize:13,marginLeft:8,color:'#374151'}}>{c.case_summary || '—'}</span>
                      </div>
                    </div>
                    <span className="iris-status-chip" style={{background:st.bg,color:st.color}}>{st.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* RIGHT SIDEBAR */}
          <div className="iris-assoc-home-sidebar">
            <div className="iris-assoc-sidebar-card">
              <div className="iris-assoc-sidebar-header">
                In queue
                <button className="iris-assoc-refresh-btn" onClick={pollQueue}>↻</button>
              </div>
              <div className="iris-assoc-queue-count">{queueCount}</div>
              <div style={{fontSize:12,color:'#6b7280',lineHeight:1.5}}>These cases are awaiting for your attention</div>
              <button className="iris-assoc-view-all" onClick={loadRecentCases}>View all</button>
            </div>
          </div>
        </div>
      )}

      {/* CASE DETAIL VIEW */}
      {activeCase && (
        <CaseDetailView
          baseUrl={baseUrl}
          flexClient={flexClient}
          caseEntry={activeCase}
          voiceCall={activeCalls[activeCase.case_id] || null}
          onClose={(resolve) => closeCase(activeCase.case_id, resolve)}
          onVoiceEnd={async () => {
            const caseId = activeCase.case_id;
            const ptSid = placeholderTasks[caseId];
            if (ptSid) { try { await flexClient.execute(new CompleteTask(ptSid)); } catch (e) { console.warn(e); } }
            setActiveCalls(prev => { const n = {...prev}; delete n[caseId]; return n; });
            setPlaceholderTasks(prev => { const n = {...prev}; delete n[caseId]; return n; });
          }}
        />
      )}
    </div>
  );
}

function CaseDetailView({ baseUrl, flexClient, caseEntry, voiceCall, onClose, onVoiceEnd }) {
  const [commTab, setCommTab] = useState('all');
  const attrs = caseEntry.attrs || {};
  const channel = attrs.channel;
  const taskSid = caseEntry.taskSid;
  const conversationSid = attrs.conversationSid || attrs.conversation_sid || '';

  return (
    <div className="iris-assoc-detail">
      {/* LEFT OVERVIEW */}
      <div className="iris-assoc-detail-left">
        <div className="iris-assoc-detail-case-id">
          Case <span style={{fontWeight:700}}>#{attrs.case_id}</span>
          <span className="iris-status-chip" style={{background:STATUS.wip.bg,color:STATUS.wip.color,marginLeft:8}}>In Progress</span>
        </div>

        <div className="iris-assoc-overview-section">
          <div className="iris-assoc-overview-label">Category</div>
          <div className="iris-assoc-overview-val" style={{fontWeight:600,color:'#0071CE'}}>{attrs.help_category}</div>
          {attrs.case_summary && <div style={{fontSize:13,color:'#374151',marginTop:6,lineHeight:1.5}}>{attrs.case_summary}</div>}
        </div>

        <div className="iris-assoc-overview-section">
          <div className="iris-assoc-overview-label">About</div>
          <div className="iris-assoc-info-row">
            <span style={{fontSize:13}}>🏢</span>
            <span style={{fontSize:13,color:'#374151'}}>{attrs.seller_name}</span>
          </div>
          {attrs.seller_email && (
            <div className="iris-assoc-info-row">
              <span style={{fontSize:13}}>✉</span>
              <span style={{fontSize:13,color:'#374151'}}>{attrs.seller_email}</span>
            </div>
          )}
          {attrs.seller_phone && (
            <div className="iris-assoc-info-row">
              <span style={{fontSize:13}}>📞</span>
              <span style={{fontSize:13,color:'#374151'}}>{attrs.seller_phone}</span>
            </div>
          )}
        </div>

        <div className="iris-assoc-detail-actions">
          <button className="iris-assoc-action-btn btn-resolve" onClick={() => onClose(true)}>Resolve</button>
          <button className="iris-assoc-action-btn btn-close" onClick={() => onClose(false)}>Save & Close</button>
        </div>
      </div>

      {/* RIGHT COMMUNICATION */}
      <div className="iris-assoc-detail-right">
        <div className="iris-assoc-comm-tabs">
          {['all', 'emails', 'comments'].map(t => (
            <button
              key={t}
              className={`iris-assoc-comm-tab${commTab === t ? ' active' : ''}`}
              onClick={() => setCommTab(t)}
            >
              {t === 'all' ? 'All messages' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div className="iris-assoc-comm-body">
          {voiceCall && (
            <PhoneControls
              call={voiceCall}
              sellerName={attrs.seller_name}
              sellerPhone={attrs.seller_phone}
              onEnd={onVoiceEnd}
            />
          )}

          {channel === 'chat' && conversationSid && (commTab === 'all') && (
            <ChatWindow
              baseUrl={baseUrl}
              flexClient={flexClient}
              taskSid={taskSid}
              conversationSid={conversationSid}
              identity="associate1"
            />
          )}

          {channel === 'email' && taskSid && (commTab === 'all' || commTab === 'emails') && (
            <EmailThreadView
              baseUrl={baseUrl}
              flexClient={flexClient}
              taskSid={taskSid}
              conversationSid={conversationSid}
              identity="associate1"
              caseId={attrs.case_id}
              subject={attrs.case_summary ? `[${attrs.case_id}] ${attrs.case_summary}` : attrs.case_id}
              sellerEmail={attrs.seller_email || ''}
              taskAttrs={attrs}
            />
          )}

          {channel === 'phone' && !voiceCall && (
            <div className="iris-assoc-comm-empty">
              <div style={{fontSize:32,marginBottom:8}}>📞</div>
              <div style={{fontSize:13,color:'#9ca3af'}}>Call ended or not yet started</div>
            </div>
          )}

          {(commTab === 'comments') && (
            <div className="iris-assoc-comm-empty">
              <div style={{fontSize:13,color:'#9ca3af'}}>No comments yet</div>
            </div>
          )}

          {commTab === 'all' && channel !== 'chat' && channel !== 'email' && channel !== 'phone' && (
            <div className="iris-assoc-comm-empty">
              <div style={{fontSize:13,color:'#9ca3af'}}>No messages yet</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
