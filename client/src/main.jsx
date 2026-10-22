import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

function logRendererError(message, stack) {
  try { window.electron?.ipcRenderer?.send('app.logRendererError', { message, stack }); } catch (_) {}
}

window.addEventListener('error', (e) => {
  logRendererError(e.message, e.error?.stack || '(no stack)');
});

window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason;
  logRendererError(
    reason instanceof Error ? reason.message : String(reason),
    reason instanceof Error ? reason.stack : '(no stack)'
  );
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
