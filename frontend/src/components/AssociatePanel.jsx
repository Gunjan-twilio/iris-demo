import { useEffect, useState, useRef } from 'react';
import {
  AcceptTask,
  RejectTask,
  EndTask,
  CompleteTask,
  SetCurrentActivity,
  AddVoiceEventListener,
} from '@twilio/flex-sdk';
import ChatWindow from './ChatWindow.jsx';
import EmailThreadView from './EmailThreadView.jsx';
import PhoneControls from './PhoneControls.jsx';
import CaseHistory from './CaseHistory.jsx';

export default function AssociatePanel({ baseUrl, flexClient }) {
  const [activity, setActivity] = useState('Offline');
  const [worker, setWorker] = useState(null);
  const [reservations, setReservations] = useState([]); // accepted reservations with task
  const [pendingReservation, setPendingReservation] = useState(null);
  const [taskAttrs, setTaskAttrs] = useState(null);
  const [countdown, setCountdown] = useState(20);
  const [activeCall, setActiveCall] = useState(null);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const countdownRef = useRef(null);

  // Init worker and wire up flex-sdk events
  useEffect(() => {
    if (!flexClient) return;

    let mounted = true;

    const init = async () => {
      const w = await flexClient.getWorker();
      if (!mounted) return;

      setWorker(w);
      setActivity(w.activity.name);

      // Pick up reservations that exist at load time
      Array.from(w.reservations.values()).forEach(res => {
        if (['pending', 'accepted', 'wrapping'].includes(res.status)) {
          attachReservationListeners(res);
          if (res.status === 'pending') {
            setPendingReservation(res);
            setTaskAttrs(res.task.attributes);
            setCountdown(20);
          } else if (res.status === 'accepted' || res.status === 'wrapping') {
            setReservations(prev => [...prev, res]);
            setTaskAttrs(res.task.attributes);
          }
        }
      });

      w.on('activityUpdated', updated => {
        setActivity(updated.activity.name);
      });

      w.on('reservationCreated', res => {
        attachReservationListeners(res);
        setPendingReservation(res);
        setTaskAttrs(res.task.attributes);
        setCountdown(20);
      });
    };

    const attachReservationListeners = (res) => {
      res.on('accepted', updated => {
        setPendingReservation(null);
        setReservations(prev => [...prev.filter(r => r.sid !== updated.sid), updated]);
        setTaskAttrs(updated.task.attributes);
      });
      res.on('rejected', updated => {
        setPendingReservation(null);
        setTaskAttrs(null);
      });
      res.on('completed', updated => {
        setReservations(prev => prev.filter(r => r.sid !== updated.sid));
        setHistoryRefresh(n => n + 1);
      });
      res.on('wrapup', updated => {
        setReservations(prev => prev.map(r => r.sid === updated.sid ? updated : r));
      });
      res.on('canceled', () => setPendingReservation(null));
      res.on('rescinded', () => setPendingReservation(null));
      res.on('timeout', () => setPendingReservation(null));
    };

    // Voice incoming calls
    flexClient.execute(
      new AddVoiceEventListener('incoming', call => {
        setActiveCall(call);
        call.call?.on('disconnect', () => setActiveCall(null));
        call.call?.on('cancel', () => setActiveCall(null));
      })
    );

    init().catch(console.error);

    return () => { mounted = false; };
  }, [flexClient]);

  // Restore active wip case on refresh
  useEffect(() => {
    if (!baseUrl) return;
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
            conversationSid: c.conversation_sid || '',
            task_sid: c.task_sid || '',
          });
        }
      })
      .catch(console.error);
  }, [baseUrl]);

  // Countdown for pending reservation
  useEffect(() => {
    if (!pendingReservation) return;
    const res = pendingReservation;
    countdownRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(countdownRef.current);
          flexClient?.execute(new RejectTask(res.task.sid)).catch(console.error);
          setPendingReservation(null);
          setTaskAttrs(null);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(countdownRef.current);
  }, [pendingReservation]);

  const goAvailable = async () => {
    if (!worker) return;
    const avail = Array.from(worker.activities.values()).find(a => a.name === 'Available');
    if (avail) await flexClient.execute(new SetCurrentActivity(avail.sid));
  };

  const goOffline = async () => {
    if (!worker) return;
    const offline = Array.from(worker.activities.values()).find(a => a.name === 'Offline');
    if (offline) await flexClient.execute(new SetCurrentActivity(offline.sid));
  };

  const handleAccept = async () => {
    clearInterval(countdownRef.current);
    if (!pendingReservation) return;
    try {
      await flexClient.execute(new AcceptTask(pendingReservation.task.sid, {
        conferenceOptions: { endConferenceOnCustomerExit: true, endConferenceOnExit: false },
      }));
      // Also update Airtable via server
      await fetch(`${baseUrl}/accept-reservation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_sid: pendingReservation.task.sid,
          reservation_sid: pendingReservation.sid,
          channel: taskAttrs?.channel,
          seller_phone: taskAttrs?.seller_phone || '',
          seller_email: taskAttrs?.seller_email || '',
          case_id: taskAttrs?.case_id,
          conversation_sid: taskAttrs?.conversationSid || taskAttrs?.conversation_sid || '',
        }),
      });
    } catch (err) {
      console.error('Accept error:', err);
    }
  };

  const handleReject = async () => {
    clearInterval(countdownRef.current);
    if (!pendingReservation) return;
    try {
      await flexClient.execute(new RejectTask(pendingReservation.task.sid));
    } catch (err) {
      console.error('Reject error:', err);
    } finally {
      setPendingReservation(null);
      setTaskAttrs(null);
    }
  };

  const handleEnd = async (resolve, taskSid) => {
    try {
      await flexClient.execute(new EndTask(taskSid));
      if (taskAttrs?.case_id) {
        await fetch(`${baseUrl}/resolve-case`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ case_id: taskAttrs.case_id, resolve }),
        });
      }
    } catch (err) {
      console.error('End task error:', err);
    }
    setTaskAttrs(null);
    setHistoryRefresh(n => n + 1);
  };

  const activityClass =
    activity === 'Available' ? 'status-available' :
    activity === 'Busy' ? 'status-busy' : 'status-offline';

  // The active accepted reservation (first one, for single-task capacity)
  const activeReservation = reservations[0] || null;
  const activeTaskSid = activeReservation?.task?.sid || taskAttrs?.task_sid || null;
  const conversationSid = taskAttrs?.conversationSid || taskAttrs?.conversation_sid || null;
  const showHistory = taskAttrs?.case_id && !pendingReservation && !activeReservation;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className={`status-badge ${activityClass}`}>{activity}</span>
        {activity !== 'Available' ? (
          <button className="btn btn-success" onClick={goAvailable} disabled={!flexClient}>Go Available</button>
        ) : (
          <button className="btn btn-ghost" onClick={goOffline}>Go Offline</button>
        )}
      </div>

      <hr className="divider" />

      {/* Pending reservation — show accept/reject card */}
      {pendingReservation && taskAttrs && (
        <div className="task-card">
          <div className="task-card-header">
            <span className="task-card-title">Incoming Case</span>
            <span className="countdown">{countdown}s</span>
          </div>
          <div className="task-card-meta">Seller: <strong>{taskAttrs.seller_name}</strong></div>
          <div className="task-card-meta">Category: <strong>{taskAttrs.help_category || taskAttrs.skill}</strong></div>
          <div className="task-card-meta">Channel: <strong>{taskAttrs.channel}</strong></div>
          <div className="task-card-meta">Case: <strong>{taskAttrs.case_id}</strong></div>
          {taskAttrs.case_summary && <div className="task-card-meta">Summary: <strong>{taskAttrs.case_summary}</strong></div>}
          <div className="btn-row">
            <button className="btn btn-success" onClick={handleAccept}>Accept</button>
            <button className="btn btn-danger" onClick={handleReject}>Reject</button>
          </div>
        </div>
      )}

      {/* Active email conversation */}
      {(activeReservation || activeTaskSid) && taskAttrs?.channel === 'email' && conversationSid && (
        <EmailThreadView
          baseUrl={baseUrl}
          flexClient={flexClient}
          taskSid={activeTaskSid}
          conversationSid={conversationSid}
          identity="associate1"
          caseId={taskAttrs?.case_id}
          subject={taskAttrs?.case_summary ? `[${taskAttrs.case_id}] ${taskAttrs.case_summary}` : taskAttrs?.case_id}
          sellerEmail={taskAttrs?.seller_email || ''}
          taskAttrs={taskAttrs}
          onEnd={(resolve) => handleEnd(resolve, activeTaskSid)}
        />
      )}

      {/* Active chat conversation */}
      {(activeReservation || activeTaskSid) && taskAttrs?.channel === 'chat' && conversationSid && (
        <ChatWindow
          baseUrl={baseUrl}
          flexClient={flexClient}
          taskSid={activeTaskSid}
          conversationSid={conversationSid}
          identity="associate1"
          caseId={taskAttrs?.case_id}
          onEnd={(resolve) => handleEnd(resolve, activeTaskSid)}
        />
      )}

      {/* Active phone call */}
      {activeCall && (
        <PhoneControls
          call={activeCall}
          onEnd={() => {
            setActiveCall(null);
            setHistoryRefresh(n => n + 1);
            setTaskAttrs(null);
          }}
        />
      )}

      {!pendingReservation && !activeReservation && !activeCall && activity === 'Available' && !showHistory && (
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
