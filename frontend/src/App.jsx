import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';

export default function App() {
  const loc = useLocation();
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 20 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>APS Model Publisher</h1>
        <nav style={{ display: 'flex', gap: 12 }}>
          <Link to="/login" style={{ textDecoration: loc.pathname === '/login' ? 'underline' : 'none' }}>Login</Link>
          <Link to="/dashboard" style={{ textDecoration: loc.pathname === '/dashboard' ? 'underline' : 'none' }}>Dashboard</Link>
        </nav>
      </header>
      <hr />
      <Outlet />
    </div>
  );
}
