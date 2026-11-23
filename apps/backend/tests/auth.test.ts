import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp } from './setup.js';
import { FastifyInstance } from 'fastify';
import { ErrorCodes, AuthConstants } from '@review-system/shared';
import { users, sessions } from '../src/drizzle/schema.js';
import { eq } from 'drizzle-orm';
import { verifyPassword } from '../src/utils/crypto.js';

describe('Authentication & Session Integration Tests', () => {
  let app: FastifyInstance;
  let db: any;

  beforeEach(async () => {
    const testSetup = await createTestApp();
    app = testSetup.app;
    db = testSetup.db;
  });

  // 1. Successful registration
  it('1. should successfully register a new user, tenant, membership and subscription', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'owner@example.com',
        password: 'Password123!',
        fullName: 'Jane Owner',
        businessName: 'Apex Car Fitting',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();

    expect(body.user.email).toBe('owner@example.com');
    expect(body.user.fullName).toBe('Jane Owner');
    expect(body.user.isPlatformAdmin).toBe(false);
    expect(body.user).not.toHaveProperty('passwordHash');

    expect(body.activeTenant.displayName).toBe('Apex Car Fitting');
    expect(body.activeTenant.role).toBe('owner');
    expect(body.activeTenant.status).toBe('active');

    // Cookie & 7-day session verification
    const cookies = res.cookies;
    const sessionCookie = cookies.find((c) => c.name === AuthConstants.COOKIE_NAME);
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.maxAge).toBe(7 * 24 * 60 * 60); // 7 days in seconds

    // Database session expiration verification (7 days from now)
    const [dbSession] = await db.select().from(sessions);
    expect(dbSession).toBeDefined();
    const expectedExpiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const actualExpiry = new Date(dbSession.expiresAt).getTime();
    expect(Math.abs(actualExpiry - expectedExpiry)).toBeLessThan(15000); // within 15 seconds
  });

  // 2. Duplicate email rejection
  it('2. should reject duplicate email registration with 409 DUPLICATE_EMAIL', async () => {
    // First registration
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'duplicate@example.com',
        password: 'Password123!',
        fullName: 'First Owner',
        businessName: 'Business One',
      },
    });

    // Duplicate registration attempt
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'duplicate@example.com',
        password: 'DifferentPassword123!',
        fullName: 'Second Owner',
        businessName: 'Business Two',
      },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe(ErrorCodes.DUPLICATE_EMAIL);
  });

  // 3. Password hashing verification
  it('3. should store passwords hashed with Argon2id and never in plaintext', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'hashcheck@example.com',
        password: 'SecretPassword99!',
        fullName: 'Hash Checker',
        businessName: 'Hash Shop',
      },
    });

    const [dbUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, 'hashcheck@example.com'))
      .limit(1);

    expect(dbUser).toBeDefined();
    expect(dbUser.passwordHash).not.toBe('SecretPassword99!');
    expect(dbUser.passwordHash.startsWith('$argon2id$')).toBe(true);

    const isMatch = await verifyPassword('SecretPassword99!', dbUser.passwordHash);
    expect(isMatch).toBe(true);
  });

  // 4. Successful login
  it('4. should successfully log in an existing user and return session cookie', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'login@example.com',
        password: 'CorrectPassword123!',
        fullName: 'Login User',
        businessName: 'Login Workshop',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'login@example.com',
        password: 'CorrectPassword123!',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.email).toBe('login@example.com');
    expect(body.activeTenant.displayName).toBe('Login Workshop');

    const sessionCookie = res.cookies.find((c) => c.name === AuthConstants.COOKIE_NAME);
    expect(sessionCookie).toBeDefined();
  });

  // 5. Invalid credentials rejection
  it('5. should reject invalid login credentials with 401 INVALID_CREDENTIALS', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'valid@example.com',
        password: 'RealPassword123!',
        fullName: 'Real User',
        businessName: 'Real Shop',
      },
    });

    // Wrong password
    const wrongPass = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'valid@example.com',
        password: 'WrongPassword!',
      },
    });
    expect(wrongPass.statusCode).toBe(401);
    expect(wrongPass.json().error.code).toBe(ErrorCodes.INVALID_CREDENTIALS);

    // Non-existent email
    const wrongEmail = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'nonexistent@example.com',
        password: 'RealPassword123!',
      },
    });
    expect(wrongEmail.statusCode).toBe(401);
    expect(wrongEmail.json().error.code).toBe(ErrorCodes.INVALID_CREDENTIALS);
  });

  // 6. Session creation, validation, and expiration
  it('6. should reject expired sessions and clear cookie', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'sessionexp@example.com',
        password: 'Password123!',
        fullName: 'Session User',
        businessName: 'Session Shop',
      },
    });

    const cookie = regRes.cookies.find((c) => c.name === AuthConstants.COOKIE_NAME)!;

    // Verify session works before expiration
    const validRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { [AuthConstants.COOKIE_NAME]: cookie.value },
    });
    expect(validRes.statusCode).toBe(200);

    // Force expiration in DB by setting expires_at to 1 hour ago
    await db.update(sessions).set({
      expiresAt: new Date(Date.now() - 3600 * 1000),
    });

    // Request with expired session
    const expiredRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { [AuthConstants.COOKIE_NAME]: cookie.value },
    });

    expect(expiredRes.statusCode).toBe(401);
    expect(expiredRes.json().error.code).toBe(ErrorCodes.UNAUTHORIZED);

    // Verify cookie was cleared
    const clearedCookie = expiredRes.cookies.find((c) => c.name === AuthConstants.COOKIE_NAME);
    expect(clearedCookie).toBeDefined();
    expect(clearedCookie?.value).toBe('');
  });

  // 7. Logout revocation
  it('7. should immediately revoke session on logout', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'logout@example.com',
        password: 'Password123!',
        fullName: 'Logout User',
        businessName: 'Logout Shop',
      },
    });

    const cookie = regRes.cookies.find((c) => c.name === AuthConstants.COOKIE_NAME)!;

    // Logout
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: cookie.value },
    });
    expect(logoutRes.statusCode).toBe(200);

    // Verify session is revoked
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { [AuthConstants.COOKIE_NAME]: cookie.value },
    });
    expect(meRes.statusCode).toBe(401);
  });

  // 8. Authenticated user retrieval
  it('8. should return user profile and tenant list for authenticated session', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'profile@example.com',
        password: 'Password123!',
        fullName: 'Profile User',
        businessName: 'Profile Auto',
      },
    });

    const cookie = regRes.cookies.find((c) => c.name === AuthConstants.COOKIE_NAME)!;

    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { [AuthConstants.COOKIE_NAME]: cookie.value },
    });

    expect(meRes.statusCode).toBe(200);
    const body = meRes.json();
    expect(body.user.email).toBe('profile@example.com');
    expect(body.activeTenant.displayName).toBe('Profile Auto');
    expect(body.availableTenants.length).toBe(1);
  });

  // 13. Platform-admin privilege escalation prevention
  it('13. should prevent platform-admin privilege escalation during registration', async () => {
    // Malicious payload attempting to inject isPlatformAdmin = true
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'hacker@example.com',
        password: 'Password123!',
        fullName: 'Attacker',
        businessName: 'Attack Corp',
        isPlatformAdmin: true, // Attempted escalation
      },
    });

    // Zod schema is strict, so unexpected keys are rejected with 400
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(ErrorCodes.VALIDATION_ERROR);

    // Verify user was NOT created
    const [dbUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, 'hacker@example.com'));
    expect(dbUser).toBeUndefined();
  });
});
