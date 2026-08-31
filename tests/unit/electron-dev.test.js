import { describe, it, expect, vi } from 'vitest';
import { isDevServerUp, waitForServer } from '../../scripts/electron-dev.js';

/**
 * Build a minimal fetch-like function.
 *
 * @param {object|null} headers - Headers returned by every probe
 * @param {object} [options]
 * @param {Error} [options.error] - Reject every probe with this error
 * @returns {typeof fetch} Stub fetch
 */
function stubFetch(headers, { error } = {}) {
  return vi.fn(async () => {
    if (error) {
      throw error;
    }
    return {
      headers: { get: (name) => headers?.[name] ?? null },
    };
  });
}

describe('isDevServerUp', () => {
  it('accepts only servers tagged with the X-Aaron-RSS dev-server header', async () => {
    const fetchImpl = stubFetch({ 'X-Aaron-RSS': 'dev-server' });
    expect(await isDevServerUp('http://localhost:3456', { fetchImpl })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:3456', { method: 'HEAD' });
  });

  it('rejects unrelated HTTP servers on the same port', async () => {
    const fetchImpl = stubFetch({ 'X-Aaron-RSS': 'something-else' });
    expect(await isDevServerUp('http://localhost:3456', { fetchImpl })).toBe(false);
  });

  it('rejects servers without the tag header', async () => {
    const fetchImpl = stubFetch(null);
    expect(await isDevServerUp('http://localhost:3456', { fetchImpl })).toBe(false);
  });

  it('treats connection failures as "not up"', async () => {
    const fetchImpl = stubFetch(null, { error: new Error('ECONNREFUSED') });
    expect(await isDevServerUp('http://localhost:3456', { fetchImpl })).toBe(false);
  });
});

describe('waitForServer', () => {
  it('resolves once the dev server answers', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return { headers: { get: () => (calls >= 3 ? 'dev-server' : null) } };
    });
    await expect(
      waitForServer('http://localhost:3456', { timeoutMs: 2000, intervalMs: 10, fetchImpl }),
    ).resolves.toBeUndefined();
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('throws when the server never comes up within the timeout', async () => {
    const fetchImpl = stubFetch(null, { error: new Error('ECONNREFUSED') });
    await expect(
      waitForServer('http://localhost:3456', { timeoutMs: 250, intervalMs: 50, fetchImpl }),
    ).rejects.toThrow(/did not start within/);
  });
});
