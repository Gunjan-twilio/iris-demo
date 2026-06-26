import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Device } from '@twilio/voice-sdk';
import { Worker } from 'twilio-taskrouter';
import SellerPanel from './components/SellerPanel.jsx';
import AssociatePanel from './components/AssociatePanel.jsx';

const BASE_URL = import.meta.env.VITE_FUNCTIONS_BASE_URL;

function AssociatePage() {
  const [voiceDevice, setVoiceDevice] = useState(null);
  const [worker, setWorker] = useState(null);

  useEffect(() => {
    fetch(`${BASE_URL}/token?identity=associate1`)
      .then(r => r.json())
      .then(data => {
        const device = new Device(data.token, { logLevel: 1 });
        device.register();
        setVoiceDevice(device);

        const trWorker = new Worker(data.token, { logLevel: 'error' });
        setWorker(trWorker);
      })
      .catch(err => console.error('Failed to fetch token', err));
  }, []);

  return (
    <div className="app">
      <header className="app-header">IRIS — Associate Workstation</header>
      <div className="full-panel">
        <AssociatePanel baseUrl={BASE_URL} worker={worker} voiceDevice={voiceDevice} />
      </div>
    </div>
  );
}

function SellerPage() {
  return (
    <div className="app">
      <header className="app-header">IRIS — Seller Support</header>
      <div className="full-panel">
        <SellerPanel baseUrl={BASE_URL} />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/associate" element={<AssociatePage />} />
        <Route path="/seller" element={<SellerPage />} />
        <Route path="/" element={<Navigate to="/seller" replace />} />
      </Routes>
    </HashRouter>
  );
}
