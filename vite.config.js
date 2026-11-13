import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite builds the React frontend. In development it proxies /api to the Node
// backend so the browser talks to a single origin (no CORS, and the HttpOnly
// session cookie is first-party).
//
// Two terminals:
//   npm run dev:api     -> http://localhost:5000
//   npm run dev         -> http://localhost:5173  (proxies /api)
//
// For a single-process production run, `npm run build && npm start` serves the
// built SPA and the API together from port 5000.
const API_TARGET = process.env.API_TARGET || 'http://127.0.0.1:5000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: false,
    proxy: {
      '/api': {
        target: API_TARGET,
        // Keep the browser's Host header (localhost:5173) instead of rewriting
        // it to the API's address. The API validates write requests against the
        // origin the request was addressed to; rewriting Host made every dev
        // registration look cross-site. The API does not route on Host, so this
        // only affects that check.
        changeOrigin: false,
        // Server-Sent Events must not be buffered or compressed by the proxy.
        ws: false,
      },
    },
  },
});
