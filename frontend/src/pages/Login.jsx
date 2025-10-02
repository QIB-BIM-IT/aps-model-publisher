import React from 'react';
import { useNavigate } from 'react-router-dom';
import { startLogin, getToken, clearToken, me } from '../services/api';

export default function Login() {
  const nav = useNavigate();
  const [hasToken, setHasToken] = React.useState(!!getToken());
  const [checkingStatus, setCheckingStatus] = React.useState(true);

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

  async function checkAuthStatus() {
    setCheckingStatus(true);
    const token = getToken();
    if (!token) {
      setHasToken(false);
      setCheckingStatus(false);
      return;
    }
    try {
      const data = await me();
      if (!data?.token) {
        clearToken();
        setHasToken(false);
      } else {
        setHasToken(true);
      }
    } finally {
      setCheckingStatus(false);
    }
  }

  // Si le token change ailleurs (ex: /callback ou autre onglet), refléter l’état
  React.useEffect(() => {
    checkAuthStatus();

    const handleStorage = (event) => {
      if (event.key === 'jwt_token') checkAuthStatus();
    };
    const handleFocus = () => { checkAuthStatus(); };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 16px',
        background: 'linear-gradient(135deg, #111827 0%, #1f2937 50%, #0f172a 100%)',
        color: '#f9fafb',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: 'rgba(17, 24, 39, 0.65)',
          backdropFilter: 'blur(18px)',
          borderRadius: 24,
          border: '1px solid rgba(148, 163, 184, 0.18)',
          boxShadow: '0 24px 60px rgba(15, 23, 42, 0.45)',
          padding: '48px 40px',
          textAlign: 'center',
        }}
      >
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 14, letterSpacing: 3, textTransform: 'uppercase', color: '#94a3b8' }}>
            APS Model Publisher
          </div>
          <h1 style={{ fontSize: 32, margin: '12px 0 8px', fontWeight: 700, color: '#e2e8f0' }}>
            Connecte-toi
          </h1>
          <p style={{ fontSize: 16, color: '#cbd5f5', lineHeight: 1.6 }}>
            Authentifie-toi avec ton compte Autodesk pour accéder à ton tableau de bord et lancer des publications ACC.
          </p>
        </div>

        <button
          onClick={handleLogin}
          style={{
            width: '100%',
            padding: '14px 18px',
            borderRadius: 999,
            border: 'none',
            background: 'linear-gradient(135deg, #2563eb 0%, #4338ca 100%)',
            color: '#f8fafc',
            fontSize: 16,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 12px 30px rgba(59, 130, 246, 0.35)',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 18px 40px rgba(79, 70, 229, 0.45)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'none';
            e.currentTarget.style.boxShadow = '0 12px 30px rgba(59, 130, 246, 0.35)';
          }}
        >
          Se connecter avec Autodesk
        </button>

        <div style={{ marginTop: 28, color: '#94a3b8', fontSize: 14 }}>
          {checkingStatus ? (
            <span>Vérification de ton statut…</span>
          ) : hasToken ? (
            <>
              <p style={{ marginBottom: 16 }}>
                Tu es déjà connecté. Tu peux accéder à ton tableau de bord ou te déconnecter.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <button
                  onClick={handleGoDashboard}
                  style={{
                    padding: '12px 16px',
                    borderRadius: 14,
                    border: '1px solid rgba(148, 163, 184, 0.35)',
                    background: 'rgba(30, 41, 59, 0.6)',
                    color: '#e2e8f0',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Ouvrir le dashboard
                </button>
                <button
                  onClick={handleLogout}
                  style={{
                    padding: '12px 16px',
                    borderRadius: 14,
                    border: '1px solid rgba(244, 114, 182, 0.55)',
                    background: 'rgba(76, 29, 149, 0.45)',
                    color: '#fbcfe8',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Se déconnecter
                </button>
              </div>
            </>
          ) : (
            <span>Aucun compte n’est connecté pour le moment.</span>
          )}
        </div>
      </div>
    </div>
  );
}
