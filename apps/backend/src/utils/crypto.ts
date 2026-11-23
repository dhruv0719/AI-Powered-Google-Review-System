import argon2 from 'argon2';
import crypto from 'crypto';

export async function hashPassword(password: string): Promise<string> {
  const isTest = process.env.NODE_ENV === 'test';
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: isTest ? 4096 : 65536,
    timeCost: isTest ? 2 : 3, // Argon2 requires timeCost >= 2
    parallelism: isTest ? 1 : 4,
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function generateSessionToken(): string {
  // 32 bytes = 256 bits of cryptographically secure randomness
  return crypto.randomBytes(32).toString('hex');
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
