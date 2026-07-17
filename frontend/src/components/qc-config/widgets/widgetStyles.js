/** Styles inline partagés — widgets QC config (alignés Planning / qcTheme). */

export const fieldBox = {
  border: '1px solid rgba(148, 163, 184, 0.25)',
  borderRadius: 10,
  padding: 14,
  background: 'rgba(255, 255, 255, 0.75)',
};

export const labelStyle = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  color: '#475569',
  marginBottom: 4,
};

export const aideStyle = {
  display: 'block',
  fontSize: 12,
  color: '#64748b',
  marginBottom: 10,
  lineHeight: 1.4,
};

export const inputStyle = {
  width: '100%',
  maxWidth: 420,
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid rgba(148, 163, 184, 0.3)',
  background: 'rgba(248, 250, 252, 0.9)',
  fontSize: 14,
  boxSizing: 'border-box',
  color: '#0f172a',
  outline: 'none',
};

export const btnStyle = {
  padding: '8px 14px',
  borderRadius: 10,
  border: '1px solid rgba(148, 163, 184, 0.3)',
  background: 'rgba(148, 163, 184, 0.12)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  color: '#475569',
  transition: 'all 0.2s',
};

export const btnDanger = {
  ...btnStyle,
  border: '1px solid rgba(220, 38, 38, 0.35)',
  background: 'rgba(220, 38, 38, 0.08)',
  color: '#b91c1c',
};

export const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 6,
};

/** Panneau info / règle maison (lecture). */
export const infoPanel = {
  padding: '10px 12px',
  borderRadius: 10,
  background: 'rgba(241, 245, 249, 0.95)',
  border: '1px solid rgba(148, 163, 184, 0.25)',
  fontSize: 13,
  color: '#334155',
};

/** Panneau indicatif (avertissement doux). */
export const warnPanel = {
  padding: '10px 12px',
  borderRadius: 10,
  background: 'rgba(245, 158, 11, 0.1)',
  border: '1px solid rgba(245, 158, 11, 0.35)',
  fontSize: 13,
  color: '#92400e',
};

/** Sous-carte (ligne de table / infos projet). */
export const subCard = {
  border: '1px solid rgba(148, 163, 184, 0.25)',
  borderRadius: 10,
  padding: 12,
  background: 'rgba(248, 250, 252, 0.9)',
};
