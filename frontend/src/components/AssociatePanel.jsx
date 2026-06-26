import { useEffect, useState, useRef } from 'react';
import ChatWindow from './ChatWindow.jsx';
import EmailThreadView from './EmailThreadView.jsx';
import PhoneControls from './PhoneControls.jsx';
import CaseHistory from './CaseHistory.jsx';

export default function AssociatePanel({ baseUrl, worker, voiceDevice }) {
  // All sourced from TaskRouter Worker SDK — no manual SID constants needed
  const [activity, setActivity] = useState('Offline');
  const [reservation, setReservation] = useState(null);   // twilio-taskrouter Reservation object
  const [taskAttrs, setTaskAttrs] = useState(null);
  const [countdown, setCountdown] = useState(20);
  const [conversationSid, setConversationSid] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const countdownRef = useRef(null);

  // Wire up Worker SDK events
  useEffect(() => {
    if (!worker) return;

    const onReady = (w) => {
      setActivity(w.activity.name);
      // Pick up any reservation already pending or accepted before we connected
      const existing = [...w.reservations.values()].find(
        r => r.status === 'pending' || r.status === 'accepted'
      );
      if (existing) {
        setReservation(existing.status === 'pending' ? existing : null);
        setTaskAttrs(existing.task.attributes);
        if (existing.status === 'pending') setCountdown(20);
      }
    };

    const onActivityUpdated = (w) => {
      setActivity(w.activity.name);
    };

    const onReservationCreated = (res) => {
      const attrs = res.task.attributes;
      setReservation(res);
      setTaskAttrs(attrs);
      setCountdown(20);
    };

    // If worker already has a pending reservation on load (e.g. after page refresh)
    const onError = (err) => {
      console.error('TaskRouter Worker error:', err);
    };

    worker.on('ready', onReady);
    worker.on('activityUpdated', onActivityUpdated);
    worker.on('reservationCreated', onReservationCreated);
    worker.on('error', onError);

    // Restore active wip case for page refresh
    fetch(`${baseUrl}/get-active-case`)
      .then(r => r.json())
      .then(data => {
        if (data.case) {
          const c = data.case;
          setTaskAttrs({
            case_id: c.case_id,
            channel: c.channel,
            seller_name: c.seller_name,
            seller_email: c.seller_email,
            seller_phone: c.seller_phone,
            help_category: c.help_category,
            skill: c.help_category,
            case_summary: c.case_summary || '',
            conversation_sid: c.conversation_sid || '',
          });
          if (c.conversation_sid) setConversationSid(c.conversation_sid);
        }
      })
      .catch(console.error);

    return () => {
      worker.off('ready', onReady);
      worker.off('activityUpdated', onActivityUpdated);
      worker.off('reservationCreated', onReservationCreated);
      worker.off('error', onError);
    };
  }, [worker]);

  // Countdown timer when a reservation is pending
  useEffect(() => {
    if (!reservation) return;

    const currentReservation = reservation;

    countdownRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(countdownRef.current);
          currentReservation.reject().catch(console.error);
          setReservation(null);
          setTaskAttrs(null);
          return 0;
        }
        return c - 1;
      });
    }, 1000);

    return () => clearInterval(countdownRef.current);
  }, [reservation]);

  // Listen for incoming voice calls
  useEffect(() => {
    if (!voiceDevice) return;
    voiceDevice.on('incoming', call => {
      setActiveCall(call);
      call.on('disconnect', () => setActiveCall(null));
      call.on('cancel', () => setActiveCall(null));
    });
  }, [voiceDevice]);

  const goAvailable = async () => {
    if (!worker) return;
    try {
      await worker.setActivity(worker.activities.find(a => a.name === 'Available').sid);
    } catch (err) {
      console.error(err);
    }
  };

  const goOffline = async () => {
    if (!worker) return;
    try {
      await worker.setActivity(worker.activities.find(a => a.name === 'Offline').sid);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAccept = async () => {
    clearInterval(countdownRef.current);
    try {
      const res = await fetch(`${baseUrl}/accept-reservation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_sid: reservation.task.sid,
          reservation_sid: reservation.sid,
          channel: taskAttrs.channel,
          seller_phone: taskAttrs.seller_phone || '',
          seller_email: taskAttrs.seller_email || '',
          case_id: taskAttrs.case_id,
          conversation_sid: taskAttrs.conversation_sid || '',
        }),
      });
      const data = await res.json();
      setReservation(null);
      if (data.conversation_sid) setConversationSid(data.conversation_sid);
      setTaskAttrs(prev => ({ ...prev }));
    } catch (err) {
      console.error(err);
    }
  };

  const handleReject = async () => {
    clearInterval(countdownRef.current);
    if (!reservation) return;
    try {
      await reservation.reject();
    } catch (err) {
      console.error(err);
    } finally {
      setReservation(null);
      setTaskAttrs(null);
    }
  };

  const activityClass =
    activity === 'Available' ? 'status-available' :
    activity === 'Busy' ? 'status-busy' : 'status-offline';

  const showHistory = taskAttrs?.case_id && !reservation;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className={`status-badge ${activityClass}`}>{activity}</span>
        {activity !== 'Available' ? (
          <button className="btn btn-success" onClick={goAvailable} disabled={!worker}>Go Available</button>
        ) : (
          <button className="btn btn-ghost" onClick={goOffline}>Go Offline</button>
        )}
      </div>

      <hr className="divider" />

      {reservation && taskAttrs && (
        <div className="task-card">
          <div className="task-card-header">
            <span className="task-card-title">Incoming Case</span>
            <span className="countdown">{countdown}s</span>
          </div>
          <div className="task-card-meta">Seller: <strong>{taskAttrs.seller_name}</strong></div>
          <div className="task-card-meta">Category: <strong>{taskAttrs.help_category || taskAttrs.skill}</strong></div>
          <div className="task-card-meta">Channel: <strong>{taskAttrs.channel}</strong></div>
          <div className="task-card-meta">Case: <strong>{taskAttrs.case_id}</strong></div>
          <div className="btn-row">
            <button className="btn btn-success" onClick={handleAccept}>Accept</button>
            <button className="btn btn-danger" onClick={handleReject}>Reject</button>
          </div>
        </div>
      )}

      {conversationSid && taskAttrs?.channel === 'chat' && (
        <ChatWindow
          baseUrl={baseUrl}
          conversationSid={conversationSid}
          identity="associate1"
          caseId={taskAttrs?.case_id}
          onEnd={() => {
            setConversationSid(null);
            setHistoryRefresh(n => n + 1);
            setTaskAttrs(prev => ({ ...prev }));
          }}
        />
      )}

      {conversationSid && taskAttrs?.channel === 'email' && (
        <EmailThreadView
          baseUrl={baseUrl}
          conversationSid={conversationSid}
          identity="associate1"
          caseId={taskAttrs?.case_id}
          subject={taskAttrs?.case_summary ? `[${taskAttrs.case_id}] ${taskAttrs.case_summary}` : taskAttrs?.case_id}
          sellerEmail={taskAttrs?.seller_email || ''}
          onEnd={() => {
            setConversationSid(null);
            setHistoryRefresh(n => n + 1);
            setTaskAttrs(prev => ({ ...prev }));
          }}
        />
      )}

      {activeCall && (
        <PhoneControls
          call={activeCall}
          onEnd={() => {
            setActiveCall(null);
            setHistoryRefresh(n => n + 1);
            setTaskAttrs(prev => ({ ...prev }));
          }}
        />
      )}

      {!reservation && !conversationSid && !activeCall && activity === 'Available' && !showHistory && (
        <div className="waiting">Waiting for incoming cases...</div>
      )}

      {showHistory && (
        <>
          <hr className="divider" />
          <CaseHistory
            baseUrl={baseUrl}
            caseId={taskAttrs.case_id}
            sellerName={taskAttrs.seller_name}
            helpCategory={taskAttrs.help_category || taskAttrs.skill}
            sellerEmail={taskAttrs.seller_email || ''}
            refreshTrigger={historyRefresh}
          />
        </>
      )}
    </div>
  );
}
