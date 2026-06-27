import { useState, useEffect } from 'react';

export default function PhoneControls({ call, sellerName, sellerPhone, onEnd }) {
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    if (!call) return;
    const handleDisconnect = () => onEnd();
    call.on?.('disconnected', handleDisconnect);
    call.on?.('disconnect', handleDisconnect);
    return () => {
      call.off?.('disconnected', handleDisconnect);
      call.off?.('disconnect', handleDisconnect);
    };
  }, [call]);

  const toggleMute = () => {
    if (muted) {
      call.unmute();
    } else {
      call.mute();
    }
    setMuted(m => !m);
  };

  const endCall = async () => {
    try {
      await call.disconnect();
    } catch (err) {
      console.warn('disconnect error:', err);
    }
    onEnd();
  };

  return (
    <div className="phone-controls">
      <div className="phone-status">
        Call in progress — {sellerName ? `${sellerName}` : 'seller'}{sellerPhone ? ` (${sellerPhone})` : ''}
      </div>
      <div className="btn-row">
        <button className={`btn ${muted ? 'btn-danger' : 'btn-ghost'}`} onClick={toggleMute}>
          {muted ? 'Unmute' : 'Mute'}
        </button>
        <button className="btn btn-danger" onClick={endCall}>End Call</button>
      </div>
    </div>
  );
}
