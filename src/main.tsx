import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/archivo/400.css';
import '@fontsource/archivo/500.css';
import '@fontsource/archivo/600.css';
import './styles/app.css';
import { LiveProvider } from './lib/live.tsx';
import { ToastProvider } from './components/ui.tsx';
import { Home } from './pages/Home.tsx';
import { BagDrop } from './pages/BagDrop.tsx';
import { CaddieMaster } from './pages/CaddieMaster.tsx';
import { CaddieHouse } from './pages/CaddieHouse.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LiveProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/bag-drop" element={<BagDrop />} />
            <Route path="/caddie-master" element={<CaddieMaster />} />
            <Route path="/caddie-house" element={<CaddieHouse />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </LiveProvider>
  </StrictMode>,
);
