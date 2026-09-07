import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { createClient } from '@twilio/flex-sdk';
import SellerPanel from './components/SellerPanel.jsx';
import AssociatePanel from './components/AssociatePanel.jsx';

const BASE_URL = import.meta.env.VITE_FUNCTIONS_BASE_URL;

// Build-your-own-auth: the login screen provides a Flex User SID, and we mint
// an authentication token for it via the token.js backend function.
// https://www.twilio.com/docs/flex/developer/flex-sdk/authentication#option-3-build-your-own-authentication

function AssociatePage() {
  const [flexClient, setFlexClient] = useState(null);
  const [jweToken, setJweToken] = useState(() =>
    localStorage.getItem('jweToken'),
  );
  const [flexUserSid, setFlexUserSid] = useState(
    localStorage.getItem('flexUserSid') || '',
  );
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!jweToken) return;

    createClient(jweToken, {
      logLevel: 'warn',
      voiceOptions: {
        autoAcceptIncomingCalls: true,
      },
    })
      .then((client) => {
        setFlexClient(client);
      })
      .catch((err) => {
        console.error('createClient failed:', err);
        localStorage.removeItem('jweToken');
        setJweToken(null);
      });
  }, [jweToken]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      localStorage.setItem('flexUserSid', flexUserSid);
      const res = await fetch(`${BASE_URL}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flex_user_sid: flexUserSid }),
      });
      const data = await res.json();
      if (!res.ok || !data.token) {
        throw new Error(data.error || 'Failed to mint Flex token');
      }
      localStorage.setItem('jweToken', data.token);
      setJweToken(data.token);
    } catch (err) {
      setError('Error while minting Flex token');
      console.error('Error while minting Flex token', err);
    }
  };

  if (!jweToken) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
        }}
      >
        <form
          onSubmit={handleLogin}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            width: '320px',
          }}
        >
          <h2 style={{ margin: '0 0 8px' }}>Associate Login</h2>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}
          >
            Flex User SID
            <input
              type='text'
              value={flexUserSid}
              onChange={(e) => setFlexUserSid(e.target.value)}
              placeholder='e.g. FUxxxxxxxxxxxxxxxxxxxxx'
              style={{ padding: '8px', fontSize: '14px' }}
            />
          </label>
          <button type='submit' style={{ padding: '8px', fontSize: '14px' }}>
            Login
          </button>
          {error && <p style={{ color: 'red', margin: 0 }}>{error}</p>}
        </form>
      </div>
    );
  }

  return <AssociatePanel baseUrl={BASE_URL} flexClient={flexClient} />;
}

function SellerPage() {
  return <SellerPanel baseUrl={BASE_URL} />;
}

// For production app, Associate and Seller would be separate apps, but for this demo we combine them into one app with a simple router.
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path='/associate' element={<AssociatePage />} />
        <Route path='/seller' element={<SellerPage />} />
        <Route path='/' element={<Navigate to='/seller' replace />} />
      </Routes>
    </HashRouter>
  );
}
