/** Styles inline partagés — widgets QC config (cohérents avec App / Planning). */

export const fieldBox = {
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: 12,
  background: '#fff',
};

export const labelStyle = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  color: '#0f172a',
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
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid #cbd5e1',
  fontSize: 13,
  boxSizing: 'border-box',
};

export const btnStyle = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid #cbd5e1',
  background: '#f8fafc',
  fontSize: 12,
  cursor: 'pointer',
  color: '#334155',
};

export const btnDanger = {
  ...btnStyle,
  border: '1px solid #fecaca',
  background: '#fef2f2',
  color: '#b91c1c',
};

export const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 6,
};
