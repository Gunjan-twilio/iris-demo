import { useState, useEffect, useRef } from 'react';
import useQueues from '../hooks/useQueues.js';

// see also components here - https://github.com/twilio-samples/flex-sdk-demo/tree/main/src/components
export default function PhoneControls({
  call,
  sellerName,
  sellerPhone,
  onEnd,
  taskSid,
  agentContactUri,
  flexClient,
  baseUrl,
}) {
  const [muted, setMuted] = useState(false);
  const endedByAssociateRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [showTransferMenu, setShowTransferMenu] = useState(false);
  const [transferringQueueSid, setTransferringQueueSid] = useState(null);
  const [transferError, setTransferError] = useState(null);
  const [sellerOnHold, setSellerOnHold] = useState(false);
  const [holdToggling, setHoldToggling] = useState(false);
  const [holdError, setHoldError] = useState(null);
  const [transferInProgress, setTransferInProgress] = useState(false);
  const [completingTransfer, setCompletingTransfer] = useState(false);
  const [completeTransferError, setCompleteTransferError] = useState(null);
  const { queues, loading: queuesLoading, error: queuesError } = useQueues(showTransferMenu ? flexClient : null);

  useEffect(() => {
    if (!call) { setConnected(false); return; }
    const voiceSDKCall = call.call;
    if (!voiceSDKCall) return;
    setConnected(voiceSDKCall.status() === 'open');
    const handleAccept = () => setConnected(true);
    const handleDisconnect = (reason) => {
      if (endedByAssociateRef.current) {
        console.log('[Call Ended] Ended by associate via End Call button', { sellerName, sellerPhone });
      } else {
        console.log('[Call Ended] Ended NOT by associate (remote hangup/network/cancel)', { sellerName, sellerPhone, reason });
      }
      endedByAssociateRef.current = false;
      setConnected(false);
      onEnd();
    };
    voiceSDKCall.on('accept', handleAccept);
    voiceSDKCall.on('disconnect', handleDisconnect);
    voiceSDKCall.on('cancel', handleDisconnect);
    return () => {
      voiceSDKCall.off('accept', handleAccept);
      voiceSDKCall.off('disconnect', handleDisconnect);
      voiceSDKCall.off('cancel', handleDisconnect);
    };
  }, [call]);

  const toggleMute = () => {
    if (muted) {
      call.unmute();
    } else {
      call.mute();
    }
    setMuted((m) => !m);
  };

  const endCall = async () => {
    endedByAssociateRef.current = true;
    console.log('[Call Ended] Associate clicked End Call button', { sellerName, sellerPhone });
    try {
      await call.disconnect();
    } catch (err) {
      console.warn('disconnect error:', err);
    }
    onEnd();
  };

  const handleWarmTransfer = async (queue) => {
    if (!taskSid || !agentContactUri || transferringQueueSid) return;
    setTransferError(null);
    setTransferringQueueSid(queue.sid);
    try {
      const res = await fetch(`${baseUrl}/initiate-warm-transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskSid,
          targetSid: queue.sid,
          from: agentContactUri,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `initiate-warm-transfer failed (${res.status})`);
      }
      setShowTransferMenu(false);
      setSellerOnHold(true);
      setTransferInProgress(true);
    } catch (err) {
      console.error('[Warm Transfer] failed', err);
      setTransferError(err.message);
    } finally {
      setTransferringQueueSid(null);
    }
  };

  const handleToggleHold = async () => {
    if (!taskSid || holdToggling) return;
    const nextHold = !sellerOnHold;
    const endpoint = nextHold ? 'hold-seller' : 'unhold-seller';
    setHoldError(null);
    setHoldToggling(true);
    try {
      const res = await fetch(`${baseUrl}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskSid }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `${endpoint} failed (${res.status})`);
      }
      setSellerOnHold(nextHold);
    } catch (err) {
      console.error(`[${nextHold ? 'Hold' : 'Unhold'}] failed`, err);
      setHoldError(err.message);
    } finally {
      setHoldToggling(false);
    }
  };

  const handleCompleteTransfer = async () => {
    if (!taskSid || completingTransfer) return;
    setCompleteTransferError(null);
    setCompletingTransfer(true);
    try {
      const res = await fetch(`${baseUrl}/complete-warm-transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskSid, agentContactUri }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `complete-warm-transfer failed (${res.status})`);
      }
      setSellerOnHold(false);
      setTransferInProgress(false);
      await endCall();
    } catch (err) {
      console.error('[Complete Transfer] failed', err);
      setCompleteTransferError(err.message);
    } finally {
      setCompletingTransfer(false);
    }
  };

  return (
    <div className='phone-controls'>
      <div className='phone-status'>
        Call in progress — {sellerName ? `${sellerName}` : 'seller'}
        {sellerPhone ? ` (${sellerPhone})` : ''}
      </div>
      <div className='btn-row'>
        <button
          className={`btn ${muted ? 'btn-danger' : 'btn-ghost'}`}
          onClick={toggleMute}
        >
          {muted ? 'Unmute' : 'Mute'}
        </button>
        {taskSid && connected && (
          <button
            className='btn btn-ghost'
            onClick={() => setShowTransferMenu((v) => !v)}
          >
            Transfer
          </button>
        )}
        {taskSid && connected && (
          <button
            className='btn btn-ghost'
            onClick={handleToggleHold}
            disabled={holdToggling}
          >
            {holdToggling ? (sellerOnHold ? 'Unholding...' : 'Holding...') : (sellerOnHold ? 'Unhold' : 'Hold')}
          </button>
        )}
        {transferInProgress && (
          <button
            className='btn btn-ghost'
            onClick={handleCompleteTransfer}
            disabled={completingTransfer}
          >
            {completingTransfer ? 'Completing...' : 'Complete Transfer'}
          </button>
        )}
        <button className='btn btn-danger' onClick={endCall}>
          End Call
        </button>
      </div>

      {holdError && <div className='transfer-menu-error'>{holdError}</div>}
      {completeTransferError && <div className='transfer-menu-error'>{completeTransferError}</div>}

      {showTransferMenu && (
        <div className='transfer-menu'>
          {queuesLoading && <div className='transfer-menu-loading'>Loading queues...</div>}
          {transferError && <div className='transfer-menu-error'>{transferError}</div>}
          {queuesError && <div className='transfer-menu-error'>{queuesError.message || 'Failed to load queues.'}</div>}
          {!queuesLoading && queues.length === 0 && (
            <div className='transfer-menu-loading'>No queues found.</div>
          )}
          {queues.map((queue) => (
            <div key={queue.sid} className='transfer-menu-row'>
              <span className='transfer-menu-queue-name'>{queue.name}</span>
              <div className='transfer-menu-actions'>
                <button
                  className='btn btn-ghost btn-sm'
                  disabled={transferringQueueSid === queue.sid}
                  onClick={() => handleWarmTransfer(queue)}
                >
                  {transferringQueueSid === queue.sid ? 'Transferring...' : 'Warm'}
                </button>
                <button className='btn btn-ghost btn-sm' disabled title='Cold transfer is not yet implemented'>
                  Cold
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
