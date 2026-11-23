import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QRScanLanding } from './pages/public/QRScanLanding.js';
import { OwnerPortal } from './components/OwnerPortal.js';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/q/:code" element={<QRScanLanding />} />
      <Route path="/*" element={<OwnerPortal />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
