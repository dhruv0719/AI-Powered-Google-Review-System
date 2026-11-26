import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OwnerPortal } from './OwnerPortal.js';
import { api } from '../api.js';
import { AuthResponseDTO } from '@review-system/shared';

describe('OwnerPortal Component Tests', () => {
  const mockAuthData: AuthResponseDTO = {
    user: {
      id: 'usr_abc123',
      email: 'owner@apexdetailing.com',
      fullName: 'Robert Fox',
      isPlatformAdmin: false,
      createdAt: new Date().toISOString(),
    },
    activeTenant: {
      id: 'tnt_xyz789',
      slug: 'apex-detailing',
      displayName: 'Apex Detailing',
      role: 'owner',
      status: 'active',
      brandColor: '#2563EB',
      logoUrl: null,
    },
    availableTenants: [
      {
        id: 'tnt_xyz789',
        slug: 'apex-detailing',
        displayName: 'Apex Detailing',
        role: 'owner',
        status: 'active',
      },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1. should restore session on mount when authenticated and load merchant dashboard', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue(mockAuthData);
    const locSpy = vi.spyOn(api, 'getLocations').mockResolvedValue({
      locations: [
        {
          id: 'loc_1',
          tenantId: 'tnt_xyz789',
          name: 'Main Studio',
          address: '100 Car Way',
          city: 'Surat',
          state: 'Gujarat',
          postalCode: '395009',
          phone: '+919876543210',
          googleReviewUrl: 'https://g.page/r/test/review',
          isPrimary: true,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    render(<OwnerPortal />);

    await waitFor(() => {
      expect(screen.getByText('Logged in as:')).toBeInTheDocument();
    });

    expect(screen.getByText('Robert Fox')).toBeInTheDocument();
    expect(screen.getByTestId('owner-logout-button')).toBeInTheDocument();
    expect(locSpy).toHaveBeenCalledWith('tnt_xyz789');
  });

  it('2. should render OwnerAuth form when getMe returns unauthenticated (401)', async () => {
    vi.spyOn(api, 'getMe').mockRejectedValue(new Error('Authentication required'));

    render(<OwnerPortal />);

    await waitFor(() => {
      expect(screen.getByTestId('owner-auth-form')).toBeInTheDocument();
    });

    expect(screen.getByTestId('auth-mode-login-tab')).toBeInTheDocument();
    expect(screen.getByTestId('login-email-input')).toBeInTheDocument();
    expect(screen.queryByTestId('owner-logout-button')).not.toBeInTheDocument();
  });

  it('3. should handle location-loading failures separately without clearing authentication', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue(mockAuthData);
    vi.spyOn(api, 'getLocations').mockRejectedValue(new Error('Locations DB unavailable'));

    render(<OwnerPortal />);

    await waitFor(() => {
      expect(screen.getByText('Logged in as:')).toBeInTheDocument();
    });

    // User remains authenticated despite location loading failure
    expect(screen.getByText('Robert Fox')).toBeInTheDocument();
    expect(screen.queryByTestId('owner-auth-form')).not.toBeInTheDocument();
  });

  it('4. should transition smoothly from OwnerAuth to authenticated dashboard upon login success', async () => {
    vi.spyOn(api, 'getMe').mockRejectedValue(new Error('Authentication required'));
    const loginSpy = vi.spyOn(api, 'login').mockResolvedValue(mockAuthData);
    const locSpy = vi.spyOn(api, 'getLocations').mockResolvedValue({ locations: [] });

    render(<OwnerPortal />);

    await waitFor(() => {
      expect(screen.getByTestId('owner-auth-form')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('login-email-input'), {
      target: { value: 'owner@apexdetailing.com' },
    });
    fireEvent.change(screen.getByTestId('login-password-input'), {
      target: { value: 'ValidPass123!' },
    });

    fireEvent.click(screen.getByTestId('auth-submit-button'));

    await waitFor(() => {
      expect(screen.getByText('Logged in as:')).toBeInTheDocument();
    });

    expect(screen.getByText('Robert Fox')).toBeInTheDocument();
    expect(screen.queryByTestId('owner-auth-form')).not.toBeInTheDocument();
    expect(locSpy).toHaveBeenCalledWith('tnt_xyz789');
    expect(loginSpy).toHaveBeenCalledTimes(1);
  });

  it('5. should execute logout and return to OwnerAuth on successful logout', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue(mockAuthData);
    vi.spyOn(api, 'getLocations').mockResolvedValue({ locations: [] });
    const logoutSpy = vi.spyOn(api, 'logout').mockResolvedValue({ status: 'logged_out' });

    render(<OwnerPortal />);

    await waitFor(() => {
      expect(screen.getByTestId('owner-logout-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('owner-logout-button'));

    await waitFor(() => {
      expect(screen.getByTestId('owner-auth-form')).toBeInTheDocument();
    });

    expect(logoutSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Logged in as:')).not.toBeInTheDocument();
  });

  it('6. should explicitly handle logout failure and preserve user session if server logout fails', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue(mockAuthData);
    vi.spyOn(api, 'getLocations').mockResolvedValue({ locations: [] });
    vi.spyOn(api, 'logout').mockRejectedValue(new Error('Network error logging out'));

    render(<OwnerPortal />);

    await waitFor(() => {
      expect(screen.getByTestId('owner-logout-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('owner-logout-button'));

    await waitFor(() => {
      expect(screen.getByTestId('owner-logout-error')).toBeInTheDocument();
    });

    expect(screen.getByTestId('owner-logout-error')).toHaveTextContent(/Network error logging out/i);
    // User remains authenticated: session is NOT falsely claimed as cleared
    expect(screen.getByText('Robert Fox')).toBeInTheDocument();
    expect(screen.queryByTestId('owner-auth-form')).not.toBeInTheDocument();
  });
});
