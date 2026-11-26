import React, { useState, useRef } from 'react';
import { AuthConstants, AuthResponseDTO, ErrorCodes } from '@review-system/shared';
import { api } from '../api.js';

export interface OwnerAuthProps {
  onAuthSuccess: (authData: AuthResponseDTO) => void;
  initialMode?: 'login' | 'register';
}

export function OwnerAuth({ onAuthSuccess, initialMode = 'login' }: OwnerAuthProps) {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Synchronous lock to prevent concurrent duplicate submissions
  const isSubmittingRef = useRef(false);

  const switchMode = (newMode: 'login' | 'register') => {
    setMode(newMode);
    setErrorMessage(null);
    setFieldErrors({});
    // Sensibly clear sensitive password on mode toggle, but preserve email
    setPassword('');
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      errors.email = 'Email address is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      errors.email = 'Please enter a valid email address';
    }

    if (mode === 'login') {
      // Mandatory requirement 3: Login password validation must only require a non-empty password
      if (!password) {
        errors.password = 'Password is required';
      }
    } else {
      // Mandatory requirement 2: Registration password validation must follow backend minimum of 8 characters
      if (!password) {
        errors.password = 'Password is required';
      } else if (password.length < AuthConstants.MIN_PASSWORD_LENGTH) {
        errors.password = `Password must be at least ${AuthConstants.MIN_PASSWORD_LENGTH} characters`;
      }

      if (!fullName.trim()) {
        errors.fullName = 'Full name is required';
      } else if (fullName.trim().length < 2) {
        errors.fullName = 'Full name must be at least 2 characters';
      }

      if (!businessName.trim()) {
        errors.businessName = 'Business name is required';
      } else if (businessName.trim().length < 2) {
        errors.businessName = 'Business name must be at least 2 characters';
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSubmittingRef.current) {
      return;
    }

    if (!validateForm()) {
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      if (mode === 'login') {
        const res = await api.login({
          email: email.trim(),
          password,
        });
        onAuthSuccess(res);
      } else {
        const res = await api.register({
          email: email.trim(),
          password,
          fullName: fullName.trim(),
          businessName: businessName.trim(),
        });
        onAuthSuccess(res);
      }
    } catch (err: any) {
      const code = err?.code;
      if (code === ErrorCodes.INVALID_CREDENTIALS) {
        setErrorMessage('Invalid email or password.');
      } else if (code === ErrorCodes.DUPLICATE_EMAIL) {
        setErrorMessage('A user with this email address already exists.');
      } else if (code === ErrorCodes.RATE_LIMITED) {
        setErrorMessage(
          err.message || 'Too many attempts. Please try again in a few minutes.'
        );
      } else if (code === ErrorCodes.VALIDATION_ERROR && Array.isArray(err?.details)) {
        const backendFieldErrors: Record<string, string> = {};
        for (const detail of err.details) {
          if (detail.field) {
            backendFieldErrors[detail.field] = detail.issue;
          }
        }
        setFieldErrors(backendFieldErrors);
        setErrorMessage('Please check the highlighted fields below.');
      } else {
        setErrorMessage(err?.message || 'Authentication failed. Please try again.');
      }
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div
      data-testid="owner-auth-form"
      style={{
        maxWidth: '440px',
        margin: '60px auto',
        fontFamily: 'sans-serif',
        padding: '32px 24px',
        backgroundColor: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: '12px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)',
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        <h2
          style={{
            margin: '0 0 8px 0',
            fontSize: '22px',
            fontWeight: 700,
            color: '#111827',
          }}
        >
          Review SaaS Portal
        </h2>
        <p style={{ margin: 0, fontSize: '14px', color: '#6b7280' }}>
          {mode === 'login'
            ? 'Sign in to manage your locations and reviews'
            : 'Register your business to start collecting Google reviews'}
        </p>
      </div>

      {/* Mode Switch Tabs */}
      <div
        style={{
          display: 'flex',
          backgroundColor: '#f3f4f6',
          borderRadius: '8px',
          padding: '4px',
          marginBottom: '20px',
        }}
      >
        <button
          type="button"
          data-testid="auth-mode-login-tab"
          onClick={() => switchMode('login')}
          style={{
            flex: 1,
            padding: '10px 16px',
            fontSize: '14px',
            fontWeight: 600,
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            backgroundColor: mode === 'login' ? '#ffffff' : 'transparent',
            color: mode === 'login' ? '#1f2937' : '#6b7280',
            boxShadow: mode === 'login' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            transition: 'background-color 0.15s ease',
          }}
        >
          Log In
        </button>
        <button
          type="button"
          data-testid="auth-mode-register-tab"
          onClick={() => switchMode('register')}
          style={{
            flex: 1,
            padding: '10px 16px',
            fontSize: '14px',
            fontWeight: 600,
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            backgroundColor: mode === 'register' ? '#ffffff' : 'transparent',
            color: mode === 'register' ? '#1f2937' : '#6b7280',
            boxShadow: mode === 'register' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            transition: 'background-color 0.15s ease',
          }}
        >
          Register Business
        </button>
      </div>

      {/* Accessible Error Announcement Banner */}
      {errorMessage && (
        <div
          role="alert"
          aria-live="polite"
          data-testid="auth-error-banner"
          style={{
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            borderRadius: '6px',
            padding: '12px 14px',
            fontSize: '14px',
            marginBottom: '16px',
            lineHeight: 1.4,
          }}
        >
          {errorMessage}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        {mode === 'register' && (
          <>
            <div style={{ marginBottom: '16px' }}>
              <label
                htmlFor="register-business-name"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#374151',
                  marginBottom: '6px',
                }}
              >
                Business Name <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                id="register-business-name"
                data-testid="register-business-name-input"
                type="text"
                autoComplete="organization"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="e.g. Apex Auto Detailing"
                disabled={isSubmitting}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '12px',
                  fontSize: '16px', // Prevents iOS mobile auto-zoom
                  borderRadius: '6px',
                  border: fieldErrors.businessName ? '1px solid #ef4444' : '1px solid #d1d5db',
                  outline: 'none',
                  minHeight: '48px',
                }}
              />
              {fieldErrors.businessName && (
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#dc2626' }}>
                  {fieldErrors.businessName}
                </p>
              )}
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label
                htmlFor="register-full-name"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#374151',
                  marginBottom: '6px',
                }}
              >
                Your Full Name <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                id="register-full-name"
                data-testid="register-full-name-input"
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Jane Doe"
                disabled={isSubmitting}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '12px',
                  fontSize: '16px',
                  borderRadius: '6px',
                  border: fieldErrors.fullName ? '1px solid #ef4444' : '1px solid #d1d5db',
                  outline: 'none',
                  minHeight: '48px',
                }}
              />
              {fieldErrors.fullName && (
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#dc2626' }}>
                  {fieldErrors.fullName}
                </p>
              )}
            </div>
          </>
        )}

        <div style={{ marginBottom: '16px' }}>
          <label
            htmlFor="auth-email"
            style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: 600,
              color: '#374151',
              marginBottom: '6px',
            }}
          >
            Email Address <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <input
            id="auth-email"
            data-testid="login-email-input"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="owner@business.com"
            disabled={isSubmitting}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '12px',
              fontSize: '16px',
              borderRadius: '6px',
              border: fieldErrors.email ? '1px solid #ef4444' : '1px solid #d1d5db',
              outline: 'none',
              minHeight: '48px',
            }}
          />
          {fieldErrors.email && (
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#dc2626' }}>
              {fieldErrors.email}
            </p>
          )}
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label
            htmlFor="auth-password"
            style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: 600,
              color: '#374151',
              marginBottom: '6px',
            }}
          >
            Password <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <input
            id="auth-password"
            data-testid="login-password-input"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            disabled={isSubmitting}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '12px',
              fontSize: '16px',
              borderRadius: '6px',
              border: fieldErrors.password ? '1px solid #ef4444' : '1px solid #d1d5db',
              outline: 'none',
              minHeight: '48px',
            }}
          />
          {fieldErrors.password ? (
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#dc2626' }}>
              {fieldErrors.password}
            </p>
          ) : mode === 'register' ? (
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#6b7280' }}>
              Must be at least {AuthConstants.MIN_PASSWORD_LENGTH} characters.
            </p>
          ) : null}
        </div>

        <button
          type="submit"
          data-testid="auth-submit-button"
          disabled={isSubmitting}
          className="touch-press"
          style={{
            width: '100%',
            minHeight: '48px',
            padding: '12px 24px',
            backgroundColor: isSubmitting ? '#93c5fd' : '#2563eb',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            fontSize: '16px',
            fontWeight: 600,
            cursor: isSubmitting ? 'not-allowed' : 'pointer',
            transition: 'background-color 0.15s ease',
          }}
        >
          {isSubmitting
            ? mode === 'login'
              ? 'Signing In...'
              : 'Creating Business Account...'
            : mode === 'login'
            ? 'Log In'
            : 'Create Business Account'}
        </button>
      </form>

      <div style={{ textAlign: 'center', marginTop: '20px' }}>
        <button
          type="button"
          data-testid="auth-mode-toggle-link"
          onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
          style={{
            background: 'none',
            border: 'none',
            color: '#2563eb',
            fontSize: '14px',
            cursor: 'pointer',
            textDecoration: 'underline',
            padding: '8px',
          }}
        >
          {mode === 'login'
            ? "Don't have a business account? Register"
            : 'Already have an account? Log in'}
        </button>
      </div>
    </div>
  );
}
