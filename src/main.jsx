import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// Stylesheets are imported in "layer" order, from most generic to most
// specific, so later files can override earlier ones if needed.
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/pages.css';

/**
 * main.jsx
 * ---------------------------------------------------------------------------
 * The entry point of the application.
 * Vite loads this file from index.html (`<script type="module" src="/src/main.jsx">`).
 *
 * `createRoot` tells React which HTML element it owns (the empty <div id="root">
 * in index.html) and `<App />` renders the whole app inside it.
 */
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
