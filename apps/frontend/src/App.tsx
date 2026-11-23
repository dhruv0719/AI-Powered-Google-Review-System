import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { PublicCustomerLayout } from './layouts/PublicCustomerLayout.js';
import { QRScanLanding } from './pages/public/QRScanLanding.js';
import { OwnerPortal } from './components/OwnerPortal.js';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicCustomerLayout />}>
        <Route path="/q/:code" element={<QRScanLanding />} />
      </Route>
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
