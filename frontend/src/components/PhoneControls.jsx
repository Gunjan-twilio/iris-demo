import { useState, useEffect } from 'react';

// see also components here - https://github.com/twilio-samples/flex-sdk-demo/tree/main/src/components
export default function PhoneControls({
  call,
  sellerName,
  sellerPhone,
  onEnd,
}) {
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    if (!call) return;
    const voiceSDKCall = call.call;
    if (!voiceSDKCall) return;
    const handleDisconnect = () => onEnd();
    voiceSDKCall.on('disconnect', handleDisconnect);
    voiceSDKCall.on('cancel', handleDisconnect);
    return () => {
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
    try {
      await call.disconnect();
    } catch (err) {
      console.warn('disconnect error:', err);
    }
    onEnd();
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
        <button className='btn btn-danger' onClick={endCall}>
          End Call
        </button>
      </div>
    </div>
  );
}
