/**
 * Constantes de style QC — alignées sur PlanningPage / GlobalDashboard
 * (shell sombre + cartes claires, boutons bleus, inputs slate).
 * Inline uniquement ; pas de CSS global.
 */

export const pageShell = {
  minHeight: '100vh',
  background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
  padding: '40px 20px',
  color: '#e2e8f0',
};

export const pageInner = {
  maxWidth: 1100,
  margin: '0 auto',
};

export const pageTitle = {
  fontSize: 32,
  fontWeight: 700,
  background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  margin: '0 0 8px 0',
};

export const pageSubtitle = {
  margin: '0 0 28px',
  fontSize: 14,
  color: '#94a3b8',
  lineHeight: 1.5,
  maxWidth: 720,
};

/** Carte type PlanningPage (fond clair sur shell sombre). */
export const card = {
  background: 'rgba(255, 255, 255, 0.9)',
  backdropFilter: 'blur(20px)',
  borderRadius: 16,
  border: '1px solid rgba(148, 163, 184, 0.2)',
  boxShadow: '0 8px 32px rgba(15, 23, 42, 0.08)',
  padding: 24,
  marginBottom: 24,
  color: '#0f172a',
};

export const cardTitle = {
  margin: '0 0 20px 0',
  fontSize: 18,
  fontWeight: 600,
  color: '#0f172a',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

export const sectionTitle = {
  margin: '0 0 16px 0',
  fontSize: 18,
  fontWeight: 600,
  color: '#0f172a',
  paddingBottom: 10,
  borderBottom: '1px solid rgba(148, 163, 184, 0.25)',
};

export const label = {
  display: 'block',
  marginBottom: 8,
  fontSize: 13,
  fontWeight: 600,
  color: '#475569',
};

export const input = {
  width: '100%',
  padding: '12px 16px',
  borderRadius: 10,
  border: '1px solid rgba(148, 163, 184, 0.3)',
  background: 'rgba(248, 250, 252, 0.8)',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
  color: '#0f172a',
};

export const btnBase = {
  padding: '10px 20px',
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.2s',
};

export const btnPrimary = {
  ...btnBase,
  background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
  color: '#fff',
  border: 'none',
  boxShadow: '0 4px 14px rgba(37, 99, 235, 0.4)',
};

export const btnSecondary = {
  ...btnBase,
  background: 'rgba(148, 163, 184, 0.15)',
  color: '#475569',
  border: '1px solid rgba(148, 163, 184, 0.3)',
  boxShadow: 'none',
};

export const muted = {
  fontSize: 13,
  color: '#64748b',
};

export const errorBanner = {
  background: 'rgba(220, 38, 38, 0.08)',
  border: '1px solid rgba(220, 38, 38, 0.3)',
  color: '#b91c1c',
  padding: '12px 16px',
  borderRadius: 12,
  fontSize: 13,
  marginBottom: 16,
};

export const successBanner = {
  background: 'rgba(16, 185, 129, 0.1)',
  border: '1px solid rgba(16, 185, 129, 0.35)',
  color: '#047857',
  padding: '12px 16px',
  borderRadius: 12,
  fontSize: 13,
  marginBottom: 16,
};

export const controlCard = {
  border: '1px solid rgba(148, 163, 184, 0.25)',
  borderRadius: 12,
  padding: 16,
  background: 'rgba(248, 250, 252, 0.85)',
};

export const controlCardReadonly = {
  ...controlCard,
  background: 'rgba(241, 245, 249, 0.95)',
};

export const projectListBox = {
  maxHeight: 220,
  overflowY: 'auto',
  border: '1px solid rgba(148, 163, 184, 0.3)',
  borderRadius: 10,
  background: 'rgba(248, 250, 252, 0.9)',
};

export const badge = {
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 8,
  background: 'rgba(37, 99, 235, 0.1)',
  color: '#1d4ed8',
  border: '1px solid rgba(37, 99, 235, 0.2)',
};

export const badgeMuted = {
  ...badge,
  background: 'rgba(148, 163, 184, 0.15)',
  color: '#64748b',
  border: '1px solid rgba(148, 163, 184, 0.3)',
};

/** Titres de section — ordre officiel du registre QC. */
export const SECTION_TITLES = {
  1: '1. Fichier',
  2: '2. Positionnement',
  3: '3. Contenu de la modélisation',
  4: '4. Organisation Revit',
  5: '5. Paramètres',
  6: '6. Export et métadonnées',
};

/** Numéro de section (1–6) à partir du code Gxxx. */
export function sectionKeyFromCode(code) {
  const n = parseInt(String(code || '').replace(/^G/i, ''), 10);
  if (!Number.isFinite(n)) return 99;
  if (n >= 100 && n < 200) return 1;
  if (n >= 200 && n < 300) return 2;
  if (n >= 300 && n < 400) return 3;
  if (n >= 400 && n < 500) return 4;
  if (n >= 500 && n < 600) return 5;
  if (n >= 600 && n < 700) return 6;
  return 99;
}

/** Partie numérique du code (G210 → 210) pour tri croissant. */
export function controlNum(code) {
  const n = parseInt(String(code || '').replace(/^G/i, ''), 10);
  return Number.isFinite(n) ? n : 0;
}
