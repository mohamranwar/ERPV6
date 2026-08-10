import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ToastConfirmProvider } from './context/ToastConfirmContext.tsx';
import { AuthProvider } from './context/AuthContext.tsx';
import { AppTextProvider } from './context/AppTextContext.tsx';
import './index.css';
import { runSystemTests } from './utils/tests.ts';

// Run Phase 5 platform verification tests
runSystemTests();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastConfirmProvider>
      <AuthProvider>
        <AppTextProvider>
          <App />
        </AppTextProvider>
      </AuthProvider>
    </ToastConfirmProvider>
  </StrictMode>,
);

