import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
import { AuthGate } from './components/AuthGate';
import { ApprovalQueue } from './pages/ApprovalQueue';
import { PostHistory } from './pages/PostHistory';
import { InstagramToken } from './pages/InstagramToken';
import { PrivacyPolicy } from './pages/PrivacyPolicy';
import { Terms } from './pages/Terms';
import { Home } from './pages/Home';
import { TesseraLumen } from './pages/TesseraLumen';
import { Layout } from './components/Layout';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/" element={<Home />} />
        <Route path="/tessera-lumen" element={<TesseraLumen />} />
        <Route path="/history" element={<Navigate to="/app/history" replace />} />
        <Route path="/app" element={<AuthGate><Layout /></AuthGate>}>
          <Route index element={<ApprovalQueue />} />
          <Route path="history" element={<PostHistory />} />
          <Route path="instagram-setup" element={<InstagramToken />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);