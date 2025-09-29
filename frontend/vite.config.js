import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite dev server sur 3001 (CORS_ORIGIN déjà configuré côté backend)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    strictPort: true,
  },
});
