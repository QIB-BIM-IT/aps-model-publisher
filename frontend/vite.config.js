import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite dev server sur 3001 avec proxy vers backend (port 3000)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false
      }
    }
  },
});
