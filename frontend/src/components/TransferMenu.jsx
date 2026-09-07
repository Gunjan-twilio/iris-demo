import { useState } from 'react';
import { useQueues } from '../hooks/useQueues.js';
import { GetTaskParticipants } from '@twilio/flex-sdk/actions/Task';
import { HoldVoiceParticipant, UnholdVoiceParticipant } from '@twilio/flex-sdk/actions/Voice';

// Transfer to Queue for call_now (v1) voice tasks. Cold transfer redirects the
// customer's call straight into the target queue's workflow; warm transfer
// holds the customer and adds a consult leg that parks in the target queue,
// keeping the associate on the line until they're ready to hang up.
export default function TransferMenu({ baseUrl, flexClient, taskSid, conferenceTaskSid, onTransferComplete, onWarmComplete }) {
  const { queues, refetchQueues } = useQueues(flexClient);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | transferring | warm-active | error
  const [errorMessage, setErrorMessage] = useState('');
  const [warmQueueName, setWarmQueueName] = useState('');

  const toggleOpen = async () => {
    if (!open) await refetchQueues();
    setOpen((o) => !o);
  };

  const handleCold = async (queue) => {
    setStatus('transferring');
    setErrorMessage('');
    try {
      const res = await fetch(`${baseUrl}/transfer-cold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskSid, targetQueueSid: queue.queueSid }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Cold transfer failed');
      setOpen(false);
      setStatus('idle');
      onTransferComplete?.();
    } catch (err) {
      console.error('[TransferMenu] cold transfer failed', err);
      setStatus('error');
      setErrorMessage(err.message);
    }
  };

  const handleWarm = async (queue) => {
    setStatus('transferring');
    setErrorMessage('');
    try {
      // Sequential two-conference warm transfer (see start-warm-consult.js) —
      // supersedes add-participant.js. Needs this associate's own live
      // CallSid so the backend can REST-redirect that leg (not a phantom
      // participant) into /enqueue.
      const participants = await flexClient.execute(new GetTaskParticipants(taskSid));
      const self = participants.find((p) => p.type === 'agent');
      const agent1CallSid = self?.mediaProperties?.callSid;
      if (!agent1CallSid) throw new Error('Could not resolve own call leg for warm transfer');

      const res = await fetch(`${baseUrl}/start-warm-consult`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskSid, targetQueueSid: queue.queueSid, agent1CallSid }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Warm transfer failed');
      setOpen(false);
      setStatus('warm-active');
      setWarmQueueName(queue.queueName);
    } catch (err) {
      console.error('[TransferMenu] warm transfer failed', err);
      setStatus('error');
      setErrorMessage(err.message);
    }
  };

  // Holds/unholds the seller's own leg via the Flex SDK directly (no backend
  // REST call). GetTaskParticipants/Hold(Unhold)VoiceParticipant only know
  // about a task's participants when that task's own reservation created
  // the conference (via reservation.conference()) — true for the ORIGINAL
  // task, but never for a warm-transfer consult task, which joins via a
  // plain `call` instruction and custom TwiML (transfer-join-conference.js)
  // instead. So this must key off `conferenceTaskSid` (the original task's
  // SID, passed down by the caller once a warm transfer is active), not
  // this associate's own `taskSid`.
  const participantsTaskSid = conferenceTaskSid || taskSid;
  const handleSellerHold = async (hold) => {
    try {
      const participants = await flexClient.execute(new GetTaskParticipants(participantsTaskSid));
      const seller = participants.find(p => p.type !== 'agent' && p.type !== 'supervisor');
      if (!seller) return;
      if (hold) await flexClient.execute(new HoldVoiceParticipant(seller.participantSid, participantsTaskSid));
      else await flexClient.execute(new UnholdVoiceParticipant(seller.participantSid, participantsTaskSid));
    } catch (err) {
      console.error('[TransferMenu] seller hold toggle failed', err);
    }
  };

  const handleCompleteTransfer = async () => {
    // The seller is on hold in Conference 1 via the REST API (see
    // start-warm-consult.js), not via the Flex-SDK hold this component's own
    // handleSellerHold toggles — complete-warm-consult.js unholds them itself
    // as part of redirecting their leg into Conference 2.
    try {
      const res = await fetch(`${baseUrl}/complete-warm-consult`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalTaskSid: taskSid }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Complete transfer failed');
    } catch (err) {
      console.error('[TransferMenu] complete transfer failed', err);
      setStatus('error');
      setErrorMessage(err.message);
      return;
    }
    setStatus('idle');
    onWarmComplete?.();
  };

  // Available to both associates on a shared conference — Agent 1's original
  // task and Agent 2's consult task both resolve the seller's participant
  // via the same taskSid-scoped Flex SDK calls, regardless of transfer status.
  const sellerHoldControls = (
    <div className="btn-row">
      <button className="btn btn-ghost" onClick={() => handleSellerHold(true)}>Hold seller</button>
      <button className="btn btn-ghost" onClick={() => handleSellerHold(false)}>Resume seller</button>
    </div>
  );

  if (status === 'warm-active') {
    return (
      <div className="transfer-menu">
        <div className="transfer-warm-banner">
          Warm transfer to {warmQueueName || 'target queue'} in progress — customer is on hold.
        </div>
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={handleCompleteTransfer}>Complete transfer</button>
        </div>
        {sellerHoldControls}
      </div>
    );
  }

  return (
    <div className="transfer-menu" style={{ position: 'relative' }}>
      <button className="btn btn-ghost" onClick={toggleOpen} disabled={status === 'transferring'}>
        {status === 'transferring' ? 'Transferring…' : 'Transfer'}
      </button>
      {status === 'error' && <div className="transfer-error">{errorMessage}</div>}
      {open && (
        <div className="transfer-menu-popover">
          {queues.length === 0 && <div className="transfer-menu-empty">Loading queues…</div>}
          {queues.map((queue) => (
            <div key={queue.queueSid} className="transfer-menu-row">
              <span className="transfer-menu-queue-name">{queue.queueName}</span>
              <div className="btn-row">
                <button className="btn btn-ghost" onClick={() => handleCold(queue)}>Cold</button>
                <button className="btn btn-ghost" onClick={() => handleWarm(queue)}>Warm</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {sellerHoldControls}
    </div>
  );
}
