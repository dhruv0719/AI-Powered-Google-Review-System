import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OwnerAuth } from './OwnerAuth.js';
import { api } from '../api.js';
import { AuthConstants, ErrorCodes, AuthResponseDTO } from '@review-system/shared';

describe('OwnerAuth Component Tests', () => {
  const mockAuthResponse: AuthResponseDTO = {
    user: {
      id: 'usr_123',
      email: 'owner@apexcardetailing.com',
      fullName: 'Jane Doe',
      isPlatformAdmin: false,
      createdAt: new Date().toISOString(),
    },
    activeTenant: {
      id: 'tnt_456',
      slug: 'apex-car-detailing',
      displayName: 'Apex Car Detailing',
      role: 'owner',
      status: 'active',
      brandColor: '#2563EB',
      logoUrl: null,
    },
    availableTenants: [
      {
        id: 'tnt_456',
        slug: 'apex-car-detailing',
        displayName: 'Apex Car Detailing',
        role: 'owner',
        status: 'active',
      },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1. should render login form by default with accessible inputs and controls', () => {
    render(<OwnerAuth onAuthSuccess={vi.fn()} />);

    expect(screen.getByTestId('owner-auth-form')).toBeInTheDocument();
    expect(screen.getByTestId('auth-mode-login-tab')).toBeInTheDocument();
    expect(screen.getByTestId('auth-mode-register-tab')).toBeInTheDocument();
    expect(screen.getByTestId('login-email-input')).toBeInTheDocument();
    expect(screen.getByTestId('login-password-input')).toBeInTheDocument();
    expect(screen.queryByTestId('register-business-name-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('register-full-name-input')).not.toBeInTheDocument();

    const submitBtn = screen.getByTestId('auth-submit-button');
    expect(submitBtn).toBeInTheDocument();
    expect(submitBtn).toHaveTextContent(/Log In/i);
  });

  it('2. should toggle between login and registration modes, sensibly preserving email and clearing password', () => {
    render(<OwnerAuth onAuthSuccess={vi.fn()} />);

    // Type into email and password in login mode
    const emailInput = screen.getByTestId('login-email-input');
    const passwordInput = screen.getByTestId('login-password-input');

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'SecretPassword123!' } });

    // Switch to register mode
    fireEvent.click(screen.getByTestId('auth-mode-register-tab'));

    expect(screen.getByTestId('register-business-name-input')).toBeInTheDocument();
    expect(screen.getByTestId('register-full-name-input')).toBeInTheDocument();
    expect(screen.getByTestId('auth-submit-button')).toHaveTextContent(/Create Business Account/i);

    // Email is preserved, sensitive password is cleared
    expect(screen.getByTestId('login-email-input')).toHaveValue('test@example.com');
    expect(screen.getByTestId('login-password-input')).toHaveValue('');

    // Toggle link also switches back to login
    fireEvent.click(screen.getByTestId('auth-mode-toggle-link'));
    expect(screen.queryByTestId('register-business-name-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('auth-submit-button')).toHaveTextContent(/Log In/i);
    expect(screen.getByTestId('login-email-input')).toHaveValue('test@example.com');
  });

  it('3. login password validation must only require non-empty password (does not enforce 8 chars)', async () => {
    const loginSpy = vi.spyOn(api, 'login').mockResolvedValue(mockAuthResponse);
    const onAuthSuccess = vi.fn();

    render(<OwnerAuth onAuthSuccess={onAuthSuccess} initialMode="login" />);

    // Short password under 8 characters (e.g. 4 chars) should NOT be rejected by client on login
    fireEvent.change(screen.getByTestId('login-email-input'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByTestId('login-password-input'), {
      target: { value: 'pass' },
    });

    fireEvent.click(screen.getByTestId('auth-submit-button'));

    await waitFor(() => {
      expect(loginSpy).toHaveBeenCalledWith({
        email: 'user@example.com',
        password: 'pass',
      });
    });

    expect(onAuthSuccess).toHaveBeenCalledWith(mockAuthResponse);
  });

  it('4. registration password validation must enforce minimum 8 characters', async () => {
    const registerSpy = vi.spyOn(api, 'register');
    const onAuthSuccess = vi.fn();

    render(<OwnerAuth onAuthSuccess={onAuthSuccess} initialMode="register" />);

    fireEvent.change(screen.getByTestId('register-business-name-input'), {
      target: { value: 'Apex Car Care' },
    });
    fireEvent.change(screen.getByTestId('register-full-name-input'), {
      target: { value: 'Jane Doe' },
    });
    fireEvent.change(screen.getByTestId('login-email-input'), {
      target: { value: 'owner@apex.com' },
    });
    fireEvent.change(screen.getByTestId('login-password-input'), {
      target: { value: 'short' }, // 5 chars < 8
    });

    fireEvent.click(screen.getByTestId('auth-submit-button'));

    expect(
      screen.getByText(`Password must be at least ${AuthConstants.MIN_PASSWORD_LENGTH} characters`)
    ).toBeInTheDocument();
    expect(registerSpy).not.toHaveBeenCalled();
    expect(onAuthSuccess).not.toHaveBeenCalled();
  });

  it('5. should successfully submit registration and invoke onAuthSuccess with tenant context', async () => {
    const registerSpy = vi.spyOn(api, 'register').mockResolvedValue(mockAuthResponse);
    const onAuthSuccess = vi.fn();

    render(<OwnerAuth onAuthSuccess={onAuthSuccess} initialMode="register" />);

    fireEvent.change(screen.getByTestId('register-business-name-input'), {
      target: { value: 'Apex Car Care' },
    });
    fireEvent.change(screen.getByTestId('register-full-name-input'), {
      target: { value: 'Jane Doe' },
    });
    fireEvent.change(screen.getByTestId('login-email-input'), {
      target: { value: 'owner@apexcardetailing.com' },
    });
    fireEvent.change(screen.getByTestId('login-password-input'), {
      target: { value: 'SecurePassword123!' },
    });

    fireEvent.click(screen.getByTestId('auth-submit-button'));

    await waitFor(() => {
      expect(registerSpy).toHaveBeenCalledWith({
        businessName: 'Apex Car Care',
        fullName: 'Jane Doe',
        email: 'owner@apexcardetailing.com',
        password: 'SecurePassword123!',
      });
    });

    expect(onAuthSuccess).toHaveBeenCalledWith(mockAuthResponse);
  });

  it('6. should display friendly error alert on 401 INVALID_CREDENTIALS', async () => {
    const authErr = new Error('Invalid email or password');
    (authErr as any).code = ErrorCodes.INVALID_CREDENTIALS;
    vi.spyOn(api, 'login').mockRejectedValue(authErr);

    render(<OwnerAuth onAuthSuccess={vi.fn()} initialMode="login" />);

    fireEvent.change(screen.getByTestId('login-email-input'), {
      target: { value: 'wrong@example.com' },
    });
    fireEvent.change(screen.getByTestId('login-password-input'), {
      target: { value: 'WrongPassword123!' },
    });

    fireEvent.click(screen.getByTestId('auth-submit-button'));

    await waitFor(() => {
      expect(screen.getByTestId('auth-error-banner')).toBeInTheDocument();
    });

    expect(screen.getByTestId('auth-error-banner')).toHaveTextContent(/Invalid email or password/i);
  });

  it('7. should display friendly error alert on 409 DUPLICATE_EMAIL during registration', async () => {
    const dupErr = new Error('A user with this email address already exists');
    (dupErr as any).code = ErrorCodes.DUPLICATE_EMAIL;
    vi.spyOn(api, 'register').mockRejectedValue(dupErr);

    render(<OwnerAuth onAuthSuccess={vi.fn()} initialMode="register" />);

    fireEvent.change(screen.getByTestId('register-business-name-input'), {
      target: { value: 'Car Clinic' },
    });
    fireEvent.change(screen.getByTestId('register-full-name-input'), {
      target: { value: 'John Smith' },
    });
    fireEvent.change(screen.getByTestId('login-email-input'), {
      target: { value: 'existing@example.com' },
    });
    fireEvent.change(screen.getByTestId('login-password-input'), {
      target: { value: 'Password123!' },
    });

    fireEvent.click(screen.getByTestId('auth-submit-button'));

    await waitFor(() => {
      expect(screen.getByTestId('auth-error-banner')).toBeInTheDocument();
    });

    expect(screen.getByTestId('auth-error-banner')).toHaveTextContent(
      /A user with this email address already exists/i
    );
  });

  it('8. should display rate-limit guidance on 429 RATE_LIMITED', async () => {
    const rateErr = new Error('Too many login attempts. Please try again in a few minutes.');
    (rateErr as any).code = ErrorCodes.RATE_LIMITED;
    vi.spyOn(api, 'login').mockRejectedValue(rateErr);

    render(<OwnerAuth onAuthSuccess={vi.fn()} initialMode="login" />);

    fireEvent.change(screen.getByTestId('login-email-input'), {
      target: { value: 'target@example.com' },
    });
    fireEvent.change(screen.getByTestId('login-password-input'), {
      target: { value: 'GuessPassword1!' },
    });

    fireEvent.click(screen.getByTestId('auth-submit-button'));

    await waitFor(() => {
      expect(screen.getByTestId('auth-error-banner')).toBeInTheDocument();
    });

    expect(screen.getByTestId('auth-error-banner')).toHaveTextContent(
      /Too many login attempts. Please try again in a few minutes/i
    );
  });

  it('9. should prevent duplicate submissions via synchronous ref lock', async () => {
    let resolveLogin: (val: any) => void;
    const slowLogin = new Promise((resolve) => {
      resolveLogin = resolve;
    });

    const loginSpy = vi.spyOn(api, 'login').mockImplementation(() => slowLogin as any);

    render(<OwnerAuth onAuthSuccess={vi.fn()} initialMode="login" />);

    fireEvent.change(screen.getByTestId('login-email-input'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByTestId('login-password-input'), {
      target: { value: 'Password123!' },
    });

    const submitBtn = screen.getByTestId('auth-submit-button');

    // Rapid double click
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    expect(loginSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveLogin!(mockAuthResponse);
    });
  });
});
