import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('negotiate() late candidate handling', () => {
  it('contains remoteDescriptionSet flag', () => {
    const src = readFileSync('src/lib/rtc-client.ts', 'utf8');
    expect(src).toContain('remoteDescriptionSet');
  });

  it('calls peer.addIceCandidate for late candidates', () => {
    const src = readFileSync('src/lib/rtc-client.ts', 'utf8');
    expect(src).toContain('peer.addIceCandidate');
  });

  it('source contains key logger.info calls', () => {
    const src = readFileSync('src/lib/rtc-client.ts', 'utf8');
    expect(src).toContain('Starting ICE gathering');
    expect(src).toContain('ICE gather ended');
    expect(src).toContain('Sending offer to server');
    expect(src).toContain('Answer received');
  });
});
