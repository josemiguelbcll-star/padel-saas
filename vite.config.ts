import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Nota de seguridad: vite 5.x depende de esbuild <=0.24.2 (GHSA-67mh-4wv8-2f99),
// una vulnerabilidad dev-only conocida en la que el dev server responde requests
// cross-origin. Mitigamos atando el host a 'localhost' (no escucha en otras
// interfaces). Revisar este pin cuando Vite 6+ estabilice su ecosistema de plugins.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: false,
  },
});
