import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import HeartField from './components/HeartField';
import './index.css';
import { initTheme } from './store/theme';

// Before first paint. Deciding the theme inside a React effect means a
// dark-mode user gets a white flash on every cold load.
initTheme();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* The template's gold hearts, behind every page and as tall as it. */}
        <div className="relative isolate min-h-[100dvh]">
          <HeartField />
          <App />
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
