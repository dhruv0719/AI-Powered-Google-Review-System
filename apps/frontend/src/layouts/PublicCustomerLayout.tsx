import { Outlet } from 'react-router-dom';

/**
 * PublicCustomerLayout provides an ultra-light, mobile-first shell
 * for customer-facing public routes (such as QR landing pages).
 *
 * Responsibilities:
 * - Owns the single semantic <main id="main-content"> landmark for public routes.
 * - Enforces responsive horizontal centering with a maximum content width of 520px.
 * - Supports mobile notch and safe-area insets (iOS Safari viewport-fit=cover).
 * - Renders a neutral, unbranded platform footer ("Powered by Review System").
 */
export function PublicCustomerLayout() {
  return (
    <main
      id="main-content"
      style={{
        minHeight: '100vh',
        backgroundColor: '#F6FAF9',
        fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        boxSizing: 'border-box',
        paddingTop: 'max(20px, env(safe-area-inset-top, 20px))',
        paddingBottom: 'max(20px, env(safe-area-inset-bottom, 20px))',
        paddingLeft: 'max(16px, env(safe-area-inset-left, 16px))',
        paddingRight: 'max(16px, env(safe-area-inset-right, 16px))',
      }}
    >
      <div
        data-testid="customer-layout-container"
        style={{
          maxWidth: '520px',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          flex: '1 0 auto',
          justifyContent: 'center',
        }}
      >
        <Outlet />
      </div>

      <footer
        data-testid="customer-layout-footer"
        style={{
          marginTop: 'auto',
          paddingTop: '24px',
          paddingBottom: '8px',
          textAlign: 'center',
          fontSize: '12px',
          color: '#707978',
          width: '100%',
          userSelect: 'none',
          letterSpacing: '0.02em',
        }}
      >
        Powered by Review System
      </footer>
    </main>
  );
}
