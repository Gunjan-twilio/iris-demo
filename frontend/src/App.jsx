import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { createClient } from '@twilio/flex-sdk';
import SellerPanel from './components/SellerPanel.jsx';
import AssociatePanel from './components/AssociatePanel.jsx';

const BASE_URL = import.meta.env.VITE_FUNCTIONS_BASE_URL;

function AssociatePage() {
  const [flexClient, setFlexClient] = useState(null);

  useEffect(() => {
    fetch(`${BASE_URL}/token?identity=associate1`)
      .then(r => r.json())
      .then(async data => {
        try {
          const client = await createClient(data.token, { logLevel: 'debug' });
          setFlexClient(client);
        } catch (err) {
          console.error('createClient failed:', err);
        }
      })
      .catch(err => console.error('Failed to fetch token', err));
  }, []);

  return <AssociatePanel baseUrl={BASE_URL} flexClient={flexClient} />;
}

function SellerPage() {
  return <SellerPanel baseUrl={BASE_URL} />;
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
