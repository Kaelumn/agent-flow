import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthGate } from './auth';
import { ConfirmProvider, ToastProvider } from './components/ui';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <AuthGate>{(identity, signOut) => <App identity={identity} signOut={signOut} />}</AuthGate>
      </ConfirmProvider>
    </ToastProvider>
  </StrictMode>,
);
