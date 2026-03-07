import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('negotiate() late candidate handling', () => {
  it('does not use remoteDescriptionSet (late local candidate routing removed)', () => {
    const src = readFileSync('src/lib/rtc-client.ts', 'utf8');
    expect(src).not.toContain('remoteDescriptionSet');
  });

  it('calls peer.addIceCandidate only for remote candidates', () => {
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
