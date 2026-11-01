import React from 'react';
import ReactDOM from 'react-dom/client';
import './design/tokens.css';
import App from './App';
import { PasskeyGate } from './components/PasskeyGate.js';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find the root element');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <PasskeyGate><App /></PasskeyGate>
  </React.StrictMode>
);
