import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://127.0.0.1:3000', '/health': 'http://127.0.0.1:3000', '/uploads': 'http://127.0.0.1:3000' },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-helmet-async')) return 'vendor-helmet';
            if (id.includes('react-router') || id.includes('@remix-run')) return 'vendor-router';
            if (id.includes('react') || id.includes('react-dom') || id.includes('scheduler')) return 'vendor-react';
          }
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
