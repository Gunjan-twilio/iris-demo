import { useState } from 'react';

export default function PhoneControls({ call, onEnd }) {
  const [answered, setAnswered] = useState(false);
  const [muted, setMuted] = useState(false);

  const answerCall = () => {
    call.accept();
    setAnswered(true);
  };

  const toggleMute = () => {
    call.mute(!muted);
    setMuted(m => !m);
  };

  const endCall = () => {
    call.disconnect();
    onEnd();
  };

  if (!answered) {
    return (
      <div className="phone-controls">
        <div className="phone-status">Incoming call — seller will be connected once you answer</div>
        <div className="btn-row">
          <button className="btn btn-success" onClick={answerCall}>Answer</button>
          <button className="btn btn-danger" onClick={endCall}>Decline</button>
        </div>
      </div>
    );
  }

  return (
    <div className="phone-controls">
      <div className="phone-status">Call in progress — connecting seller...</div>
      <div className="btn-row">
        <button className={`btn ${muted ? 'btn-danger' : 'btn-ghost'}`} onClick={toggleMute}>
          {muted ? 'Unmute' : 'Mute'}
        </button>
        <button className="btn btn-danger" onClick={endCall}>End Call</button>
      </div>
    </div>
  );
}
