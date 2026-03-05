import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('ICE_GATHER_TIMEOUT_MS', () => {
  it('is 1500 ms', () => {
    const src = readFileSync('src/lib/rtc-client.ts', 'utf8');
    expect(src).toContain('ICE_GATHER_TIMEOUT_MS = 1_500');
  });
});
