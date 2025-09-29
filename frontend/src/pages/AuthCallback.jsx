import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { setToken, me } from '../services/api';

function getQueryParams(search) {
  const p = new URLSearchParams(search);
  const out = {};
  for (const [k, v] of p.entries()) out[k] = v;
  return out;
}

/**
 * Gère 2 cas :
 *  - Le backend renvoie ?token=<JWT>&user=... dans l’URL → on stocke et on go dashboard.
 *  - Le backend a mis un cookie JWT côté HTTP → on appelle /api/auth/me, récupère user/token si dispo.
 */
export default function AuthCallback() {
  const nav = useNavigate();
  const loc = useLocation();

  React.useEffect(() => {
    (async () => {
      const qp = getQueryParams(loc.search);
      if (qp.token) {
        setToken(qp.token);
        nav('/dashboard', { replace: true });
        return;
      }
      // fallback cookie-based
      const data = await me();
      if (data?.token) setToken(data.token);
      nav('/dashboard', { replace: true });
    })();
  }, [loc.search, nav]);

  return (
    <div>
      <h2>Finalisation de la connexion…</h2>
      <p>Patiente un instant, on valide la session.</p>
    </div>
  );
}
