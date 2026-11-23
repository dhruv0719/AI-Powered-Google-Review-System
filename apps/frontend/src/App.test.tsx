import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from './App.js';
import { publicApi } from './services/publicApi.js';
import { api } from './api.js';

describe('App Routing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1. should route /q/:code to QRScanLanding', async () => {
    vi.spyOn(publicApi, 'resolvePublicCampaign').mockResolvedValue({
      tenant: { displayName: 'Harsh Custom Car Accessories', brandColor: '#2563EB' },
      location: {
        name: 'Main Showroom',
        address: 'Adajan Road',
        city: 'Surat',
        googleReviewUrl: 'https://g.page/r/test/review',
      },
      services: [],
    });

    render(
      <MemoryRouter initialEntries={['/q/q_testCode1234567890']}>
        <AppRoutes />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('business-name')).toBeInTheDocument();
    });

    expect(screen.getByTestId('business-name')).toHaveTextContent(
      'Harsh Custom Car Accessories'
    );
    expect(screen.getByTestId('google-review-cta')).toBeInTheDocument();
  });

  it('2. should route / (or owner path) to OwnerPortal without regression', async () => {
    vi.spyOn(api, 'getMe').mockRejectedValue(new Error('Unauthorized'));

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('owner-login-prompt')).toBeInTheDocument();
    });

    expect(screen.getByText('Review SaaS Portal')).toBeInTheDocument();
  });
});
