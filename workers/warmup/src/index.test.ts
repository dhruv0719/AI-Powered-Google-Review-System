import { describe, it, expect, vi } from 'vitest';
import worker, { isWithinWarmupWindow, pingBackendHealth } from './index.js';

describe('Cloudflare Warm-Up Worker Unit Tests', () => {
  describe('isWithinWarmupWindow (IST Business Hours Scheduling)', () => {
    it('1. should skip triggers before 04:24 UTC (09:54 AM IST)', () => {
      // 04:00 UTC (09:30 AM IST)
      expect(isWithinWarmupWindow(new Date('2026-11-26T04:00:00Z'))).toBe(false);
      // 04:06 UTC (09:36 AM IST)
      expect(isWithinWarmupWindow(new Date('2026-11-26T04:06:00Z'))).toBe(false);
      // 04:12 UTC (09:42 AM IST)
      expect(isWithinWarmupWindow(new Date('2026-11-26T04:12:00Z'))).toBe(false);
      // 04:18 UTC (09:48 AM IST)
      expect(isWithinWarmupWindow(new Date('2026-11-26T04:18:00Z'))).toBe(false);
      // 04:23 UTC (09:53 AM IST)
      expect(isWithinWarmupWindow(new Date('2026-11-26T04:23:00Z'))).toBe(false);
    });

    it('2. should activate starting at 04:24 UTC (09:54 AM IST) for pre-warming', () => {
      // Exactly 04:24 UTC
      expect(isWithinWarmupWindow(new Date('2026-11-26T04:24:00Z'))).toBe(true);
      // 04:30 UTC (10:00 AM IST store open)
      expect(isWithinWarmupWindow(new Date('2026-11-26T04:30:00Z'))).toBe(true);
      // Midday (08:00 UTC = 01:30 PM IST)
      expect(isWithinWarmupWindow(new Date('2026-11-26T08:00:00Z'))).toBe(true);
    });

    it('3. should activate through 15:30 UTC (09:00 PM IST store close)', () => {
      // 15:00 UTC (08:30 PM IST)
      expect(isWithinWarmupWindow(new Date('2026-11-26T15:00:00Z'))).toBe(true);
      // 15:24 UTC (08:54 PM IST)
      expect(isWithinWarmupWindow(new Date('2026-11-26T15:24:00Z'))).toBe(true);
      // Exactly 15:30 UTC (09:00 PM IST)
      expect(isWithinWarmupWindow(new Date('2026-11-26T15:30:00Z'))).toBe(true);
    });

    it('4. should skip triggers after 15:30 UTC (after 09:00 PM IST store close)', () => {
      // 15:36 UTC (09:06 PM IST)
      expect(isWithinWarmupWindow(new Date('2026-11-26T15:36:00Z'))).toBe(false);
      // 15:42 UTC (09:12 PM IST)
      expect(isWithinWarmupWindow(new Date('2026-11-26T15:42:00Z'))).toBe(false);
      // 15:54 UTC (09:24 PM IST)
      expect(isWithinWarmupWindow(new Date('2026-11-26T15:54:00Z'))).toBe(false);
      // 20:00 UTC (01:30 AM IST next day)
      expect(isWithinWarmupWindow(new Date('2026-11-26T20:00:00Z'))).toBe(false);
    });
  });

  describe('pingBackendHealth', () => {
    it('5. should successfully ping /health', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
      });

      const res = await pingBackendHealth('https://backend.onrender.com/health', mockFetch as any);
      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://backend.onrender.com/health',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ 'User-Agent': 'Cloudflare-Warmup-Worker/1.0' }),
        })
      );
    });

    it('6. strictly rejects any ping attempt to /ready', async () => {
      const mockFetch = vi.fn();

      const res = await pingBackendHealth('https://backend.onrender.com/ready', mockFetch as any);
      expect(res.ok).toBe(false);
      expect(res.message).toContain('prohibited');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('7. safely handles network errors without crashing', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Render connection timeout'));

      const res = await pingBackendHealth('https://backend.onrender.com/health', mockFetch as any);
      expect(res.ok).toBe(false);
      expect(res.status).toBe('error');
      expect(res.message).toContain('Render connection timeout');
    });
  });

  describe('scheduled handler integration', () => {
    it('8. skips ping when scheduled time is outside operating window', async () => {
      const waitUntil = vi.fn();
      const mockEnv = { BACKEND_HEALTH_URL: 'https://backend.onrender.com/health' };

      await worker.scheduled(
        { cron: '*/6 4-15 * * *', scheduledTime: new Date('2026-11-26T04:00:00Z').getTime() },
        mockEnv,
        { waitUntil }
      );

      expect(waitUntil).not.toHaveBeenCalled();
    });

    it('9. invokes ping when scheduled time is inside operating window', async () => {
      const waitUntil = vi.fn();
      const mockEnv = { BACKEND_HEALTH_URL: 'https://backend.onrender.com/health' };

      await worker.scheduled(
        { cron: '*/6 4-15 * * *', scheduledTime: new Date('2026-11-26T04:24:00Z').getTime() },
        mockEnv,
        { waitUntil }
      );

      expect(waitUntil).toHaveBeenCalled();
    });
  });
});
