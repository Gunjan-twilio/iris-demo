import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { createClient, getAuthenticationConfig, getLoginDetails, exchangeToken } from '@twilio/flex-sdk';
import SellerPanel from './components/SellerPanel.jsx';
import AssociatePanel from './components/AssociatePanel.jsx';

const BASE_URL = import.meta.env.VITE_FUNCTIONS_BASE_URL;

// Handles the OAuth redirect back from SSO (URL has ?code=&state= but no hash).
// Exchanges the code for tokens, stores them, then navigates to the associate page.
function OAuthCallback() {
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const authConfig = JSON.parse(localStorage.getItem('auth-config') || 'null');
    const loginDetails = JSON.parse(localStorage.getItem('login-details') || 'null');

    if (!code || !state || !authConfig || !loginDetails) {
      window.location.replace('/#/associate');
      return;
    }

    exchangeToken({
      ssoProfileSid: authConfig.connectionName,
      codeVerifier: loginDetails.codeVerifier,
      nonce: loginDetails.nonce,
      code,
    }).then(tokenResponse => {
      localStorage.removeItem('auth-config');
      localStorage.removeItem('login-details');
      localStorage.setItem('jweToken', tokenResponse.accessToken);
      localStorage.setItem('refreshToken', tokenResponse.refreshToken);
      window.location.replace('/#/associate');
    }).catch(err => {
      console.error('Token exchange failed', err);
      window.location.replace('/#/associate');
    });
  }, []);

  return <div style={{ padding: '40px', textAlign: 'center' }}>Logging in...</div>;
}

function AssociatePage() {
  const [flexClient, setFlexClient] = useState(null);
  const [jweToken, setJweToken] = useState(() => localStorage.getItem('jweToken'));
  const [runtimeDomain, setRuntimeDomain] = useState(localStorage.getItem('runtimeDomain') || '');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!jweToken) return;

    const refreshToken = localStorage.getItem('refreshToken');
    const sessionOptions = refreshToken
      ? { refreshToken, autoUpdateToken: true, isConsoleLogin: false }
      : { autoUpdateToken: false };

    createClient(jweToken, {
      logLevel: 'debug',
      session: sessionOptions,
    }).then(client => {
      client.addListener('tokenUpdated', token => {
        localStorage.setItem('jweToken', token);
      });
      setFlexClient(client);
    }).catch(err => {
      console.error('createClient failed:', err);
      localStorage.removeItem('jweToken');
      localStorage.removeItem('refreshToken');
      setJweToken(null);
    });
  }, [jweToken]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      localStorage.setItem('runtimeDomain', runtimeDomain);
      const authConfig = await getAuthenticationConfig({ runtimeDomain });
      const activeConfig = authConfig.configList.find(c => c.active);
      localStorage.setItem('auth-config', JSON.stringify(activeConfig));
      const response = await getLoginDetails({
        ssoProfileSid: authConfig.configList[0].ssoProfileSid,
        clientId: authConfig.configList[0].clientId,
        redirectUrl: window.location.origin,
      });
      localStorage.setItem('login-details', JSON.stringify(response));
      window.location.href = response.loginUrl;
    } catch (err) {
      setError('Error while fetching auth config');
      console.error('Error while fetching auth config', err);
    }
  };

  if (!jweToken) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '320px' }}>
          <h2 style={{ margin: '0 0 8px' }}>Associate Login</h2>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            Runtime Domain
            <input
              type="text"
              value={runtimeDomain}
              onChange={e => setRuntimeDomain(e.target.value)}
              placeholder="e.g. iris-demo-2775-dev.twil.io"
              style={{ padding: '8px', fontSize: '14px' }}
            />
          </label>
          <button type="submit" style={{ padding: '8px', fontSize: '14px' }}>Login</button>
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

export default function App() {
  if (new URLSearchParams(window.location.search).has('code')) {
    return <OAuthCallback />;
  }

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
