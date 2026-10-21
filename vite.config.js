import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite is only a build tool + dev server. It bundles our React (JSX) code into
// plain HTML/CSS/JS that the browser can run.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: false,
    // When the Express backend is ready, uncomment this proxy so that
    // fetch('/api/drives') reaches the Node server instead of Vite.
    // proxy: {
    //   '/api': { target: 'http://localhost:5000', changeOrigin: true },
    // },
  },
});
