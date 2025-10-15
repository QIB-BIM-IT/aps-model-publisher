import React from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { clearToken, getToken } from './services/api';

export default function App() {
  const loc = useLocation();
  const nav = useNavigate();
  const isLoggedIn = !!getToken();

  function handleLogout() {
    clearToken();
    nav('/login');
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      {/* Header moderne */}
      {isLoggedIn && loc.pathname !== '/login' && loc.pathname !== '/callback' && (
        <header style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
          padding: '16px 32px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
            <h1 style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 700,
              background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>
              🚀 APS Publisher
            </h1>
            
            <nav style={{ display: 'flex', gap: 20 }}>
              <Link
                to="/dashboard"
                style={{
                  textDecoration: 'none',
                  color: loc.pathname === '/dashboard' ? '#60a5fa' : '#94a3b8',
                  fontWeight: loc.pathname === '/dashboard' ? 600 : 400,
                  fontSize: 14,
                  transition: 'color 0.2s',
                  borderBottom: loc.pathname === '/dashboard' ? '2px solid #60a5fa' : 'none',
                  paddingBottom: 4
                }}
              >
                📊 Dashboard
              </Link>
              
              <Link
                to="/planning"
                style={{
                  textDecoration: 'none',
                  color: loc.pathname === '/planning' ? '#60a5fa' : '#94a3b8',
                  fontWeight: loc.pathname === '/planning' ? 600 : 400,
                  fontSize: 14,
                  transition: 'color 0.2s',
                  borderBottom: loc.pathname === '/planning' ? '2px solid #60a5fa' : 'none',
                  paddingBottom: 4
                }}
              >
                ⚙️ Planifier
              </Link>
            </nav>
          </div>

          <button
            onClick={handleLogout}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid rgba(148, 163, 184, 0.3)',
              background: 'rgba(148, 163, 184, 0.1)',
              color: '#e2e8f0',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            🚪 Déconnexion
          </button>
        </header>
      )}
      
      <Outlet />
    </div>
  );
}
