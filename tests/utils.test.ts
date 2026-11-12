import { describe, it, expect, vi } from 'vitest';
import { RateLimiter } from '../src/utils/rate-limiter.js';
import { ErrorCodes, ReviewError, formatError, withRetry, withTimeout } from '../src/utils/error-handler.js';

describe('withRetry', () => {
  it('returns the value on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, 3, 1)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries failures and eventually succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('a')).mockRejectedValueOnce(new Error('b')).mockResolvedValue('ok');
    await expect(withRetry(fn, 3, 1)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws RETRY_EXHAUSTED when every attempt fails', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('nope'));
    await expect(withRetry(fn, 2, 1)).rejects.toMatchObject({ code: ErrorCodes.RETRY_EXHAUSTED });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('rethrows immediately when shouldRetry says no', async () => {
    const fatal = new ReviewError('fatal', ErrorCodes.INVALID_CONFIG);
    const fn = vi.fn().mockRejectedValue(fatal);
    await expect(withRetry(fn, 5, 1, () => false)).rejects.toBe(fatal);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('withTimeout', () => {
  it('resolves when the work finishes in time', async () => {
    await expect(withTimeout(async () => 42, 100)).resolves.toBe(42);
  });

  it('rejects with AGENT_TIMEOUT when the work is too slow', async () => {
    const slow = () => new Promise<void>(resolve => setTimeout(resolve, 200));
    await expect(withTimeout(slow, 10, 'too slow')).rejects.toMatchObject({
      code: ErrorCodes.AGENT_TIMEOUT,
      message: 'too slow'
    });
  });

  it('does not leave a pending timer after success', async () => {
    vi.useFakeTimers();
    try {
      await withTimeout(async () => 1, 10_000);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('formatError', () => {
  it('includes the code for ReviewError and handles non-errors', () => {
    expect(formatError(new ReviewError('boom', ErrorCodes.AGENT_FAILED))).toBe('[AGENT_FAILED] boom');
    expect(formatError(new Error('plain'))).toBe('plain');
    expect(formatError('text')).toBe('text');
  });
});

describe('RateLimiter', () => {
  it('tracks active requests and frees them on release', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 2, maxRequestsPerMinute: 10, maxTokensPerMinute: 10_000 });
    await limiter.acquire(100);
    await limiter.acquire(100);
    expect(limiter.getStatus().activeRequests).toBe(2);
    expect(limiter.canProceed(100)).toBe(false);
    limiter.release();
    expect(limiter.getStatus().activeRequests).toBe(1);
    expect(limiter.canProceed(100)).toBe(true);
  });

  it('blocks a third concurrent request until a slot is released', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1, maxRequestsPerMinute: 10, maxTokensPerMinute: 10_000 });
    await limiter.acquire(10);
    let second = false;
    const pending = limiter.acquire(10).then(() => { second = true; });
    await new Promise(r => setTimeout(r, 20));
    expect(second).toBe(false);
    limiter.release();
    await pending;
    expect(second).toBe(true);
  });

  it('replaces the token estimate with actual usage on release', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1, maxRequestsPerMinute: 10, maxTokensPerMinute: 10_000 });
    await limiter.acquire(5000);
    limiter.release(1200);
    expect(limiter.getStatus().tokensInWindow).toBe(1200);
  });

  it('reports remaining capacity', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 3, maxRequestsPerMinute: 5, maxTokensPerMinute: 1000 });
    await limiter.acquire(400);
    const s = limiter.getStatus();
    expect(s.availableRequests).toBe(4);
    expect(s.availableTokens).toBe(600);
  });
});
