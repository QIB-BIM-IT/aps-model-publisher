import React from 'react';
import { useNavigate } from 'react-router-dom';
import { startLogin, getToken, clearToken } from '../services/api';

export default function Login() {
  const nav = useNavigate();
  const [hasToken, setHasToken] = React.useState(!!getToken());

  function handleLogin() {
    // force l’écran de connexion Autodesk
    startLogin({ forceLogin: true });
  }

  function handleGoDashboard() {
    nav('/dashboard', { replace: true });
  }

  function handleLogout() {
    clearToken();
    setHasToken(false);
  }

  // Si le token change ailleurs (ex: /callback), refléter l’état
  React.useEffect(() => {
    const i = setInterval(() => {
      const t = !!getToken();
      setHasToken((prev) => (prev !== t ? t : prev));
    }, 500);
    return () => clearInterval(i);
  }, []);

  return (
    <div style={{ maxWidth: 520 }}>
      <h2>Connexion</h2>
      <p>Connecte-toi avec ton compte Autodesk pour explorer tes hubs et projets ACC.</p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
        <button
          onClick={handleLogin}
          style={{ padding: '10px 16px', fontSize: 16, cursor: 'pointer' }}
        >
          Se connecter avec Autodesk
        </button>

        {hasToken && (
          <>
            <button
              onClick={handleGoDashboard}
              style={{ padding: '8px 12px', cursor: 'pointer' }}
            >
              Aller au Dashboard
            </button>
            <button
              onClick={handleLogout}
              style={{ padding: '8px 12px', cursor: 'pointer' }}
            >
              Se déconnecter
            </button>
          </>
        )}
      </div>
    </div>
  );
}
