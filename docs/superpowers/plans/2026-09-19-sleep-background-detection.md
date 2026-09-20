# Sleep & Background Detection Implementation Plan

> **Superseded on 2026-09-20.** The `sleep` stop path this plan builds was removed. Hidden pages no longer stop the session; see `docs/Browser Background Behavior.md`.

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop data collection cleanly when the page wakes from a sleep/freeze (lid close, screen lock, mobile tab switch), while leaving desktop/laptop tab switches untouched.

**Architecture:** All changes in `src/lib/webrtc.ts`. On `visibilitychange`, record hide time and probe count. On show, if gap >30s and no new probes were received, call `disconnect('sleep')`. No timers needed — the probe count is the signal. Export `isMobile()` as a pure function for unit testing.

**Tech Stack:** TypeScript, Page Visibility API (`document.visibilityState`, `document.hidden`), Vitest + jsdom

**Spec:** `docs/superpowers/specs/2026-09-19-sleep-background-detection-design.md`

---

## Chunk 1: Implementation and tests

### Task 1: Write failing tests

**Files:**
- Create: `tests/webrtc-visibility.test.ts`

- [ ] **Step 1: Create the test file**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// Unit tests for isMobile() using jsdom's navigator
describe('isMobile()', () => {
	const setNavigator = (maxTouchPoints: number, userAgent: string) => {
		Object.defineProperty(navigator, 'maxTouchPoints', {
			get: () => maxTouchPoints,
			configurable: true
		});
		Object.defineProperty(navigator, 'userAgent', {
			get: () => userAgent,
			configurable: true
		});
	};

	it('returns true for Android Chrome', async () => {
		setNavigator(5, 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Mobile Safari/537.36');
		const { isMobile } = await import('../src/lib/webrtc');
		expect(isMobile()).toBe(true);
	});

	it('returns true for iPhone Safari', async () => {
		setNavigator(5, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1');
		const { isMobile } = await import('../src/lib/webrtc');
		expect(isMobile()).toBe(true);
	});

	it('returns false for desktop Chrome (no touch, no mobile UA)', async () => {
		setNavigator(0, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');
		const { isMobile } = await import('../src/lib/webrtc');
		expect(isMobile()).toBe(false);
	});

	it('returns false when maxTouchPoints is 0 even with mobile UA', async () => {
		setNavigator(0, 'Mozilla/5.0 (Linux; Android 13) Mobile Safari/537.36');
		const { isMobile } = await import('../src/lib/webrtc');
		expect(isMobile()).toBe(false);
	});

	it('returns false when UA has no mobile keyword even with touch points', async () => {
		setNavigator(5, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
		const { isMobile } = await import('../src/lib/webrtc');
		expect(isMobile()).toBe(false);
	});
});

// Source-inspection tests — verify the visibility handling is wired up
describe('visibility stop — source checks', () => {
	const src = readFileSync('src/lib/webrtc.ts', 'utf8');

	it("includes 'sleep' in DisconnectReason type", () => {
		expect(src).toContain("'sleep'");
	});

	it('defines VISIBILITY_STOP_DELAY_MS constant', () => {
		expect(src).toContain('VISIBILITY_STOP_DELAY_MS');
	});

	it('tracks hiddenAt and probeCountAtHide', () => {
		expect(src).toContain('hiddenAt');
		expect(src).toContain('probeCountAtHide');
	});

	it('attaches and removes visibilitychange listener', () => {
		expect(src).toContain("'visibilitychange'");
		expect(src).toContain('addEventListener');
		expect(src).toContain('removeEventListener');
	});

	it('uses document.hidden to detect background', () => {
		expect(src).toContain('document.hidden');
	});

	it('contains mobile stop message', () => {
		expect(src).toContain('Cutie only works when visible');
	});

	it('contains non-mobile stop message', () => {
		expect(src).toContain('computer went to sleep');
	});
});
```

- [ ] **Step 2: Run tests — confirm they all fail**

```bash
npm test -- --reporter=verbose tests/webrtc-visibility.test.ts
```

Expected: all tests FAIL (`isMobile` not exported, strings/constants not present yet).

---

### Task 2: Add type, constant, exported helper, and module variables

**Files:**
- Modify: `src/lib/webrtc.ts`

- [ ] **Step 1: Add `'sleep'` to `DisconnectReason`**

Find line 32:
```ts
export type DisconnectReason = 'manual' | 'timeout' | 'error' | 'auto' | 'reload';
```
Change to:
```ts
export type DisconnectReason = 'manual' | 'timeout' | 'error' | 'auto' | 'reload' | 'sleep';
```

- [ ] **Step 2: Add `isMobile()` export below the `DisconnectReason` type**

```ts
export function isMobile(): boolean {
	if (typeof navigator === 'undefined') return false;
	return navigator.maxTouchPoints > 0 && /Mobi|Android/i.test(navigator.userAgent);
}
```

- [ ] **Step 3: Add the constant after `COLLECTION_DURATION_MS`**

After `const COLLECTION_DURATION_MS = 2 * 60 * 60 * 1000;` add:
```ts
const VISIBILITY_STOP_DELAY_MS = 30_000;
```

- [ ] **Step 4: Add module-level variables after `let epochOffsetMs`**

After `let epochOffsetMs = 0;` add:
```ts
let hiddenAt: number | null = null;
let probeCountAtHide: number | null = null;
let visibilityChangeHandler: (() => void) | null = null;
```

- [ ] **Step 5: Run source-inspection tests — they should now pass**

```bash
npm test -- --reporter=verbose tests/webrtc-visibility.test.ts
```

Expected: all 7 source-inspection tests PASS; `isMobile()` unit tests still fail (Vitest module cache — will clear once the export is live, which it now is; re-run if needed with `--no-cache`).

---

### Task 3: Wire the `visibilitychange` listener

**Files:**
- Modify: `src/lib/webrtc.ts`

- [ ] **Step 1: Build and attach the handler in `beginCollectionSession()`**

`beginCollectionSession()` ends with `latencyProbe.start(dataChannel)`. Add after it:

```ts
	if (typeof document !== 'undefined') {
		visibilityChangeHandler = () => {
			if (document.hidden) {
				hiddenAt = Date.now();
				probeCountAtHide = get(webrtcState).latencyStats.totalReceived;
			} else {
				if (
					hiddenAt !== null &&
					probeCountAtHide !== null &&
					Date.now() - hiddenAt > VISIBILITY_STOP_DELAY_MS &&
					get(webrtcState).latencyStats.totalReceived === probeCountAtHide
				) {
					hiddenAt = null;
					probeCountAtHide = null;
					const { connection, isDisconnecting } = get(webrtcState);
					if (connection && !isDisconnecting) {
						void disconnect('sleep');
					}
				} else {
					hiddenAt = null;
					probeCountAtHide = null;
				}
			}
		};
		document.addEventListener('visibilitychange', visibilityChangeHandler);
	}
```

- [ ] **Step 2: Remove the listener in `disconnect()`**

In `disconnect()`, after the `clearCollectionAutoStopTimer()` call, add:

```ts
	hiddenAt = null;
	probeCountAtHide = null;
	if (typeof document !== 'undefined' && visibilityChangeHandler) {
		document.removeEventListener('visibilitychange', visibilityChangeHandler);
		visibilityChangeHandler = null;
	}
```

- [ ] **Step 3: Handle `'sleep'` in the message block of `disconnect()`**

Find the message-building block (the `if (!options.suppressMessage)` block) and add the `sleep` case:

```ts
		} else if (reason === 'sleep') {
			collectionStatusMessage = isMobile()
				? 'Collection stopped — Cutie only works when visible'
				: 'Collection stopped — computer went to sleep';
		}
```

Place it after the `else if (reason === 'auto')` branch.

---

### Task 4: Verify everything passes

**Files:** none

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all tests PASS, no new failures.

- [ ] **Step 2: Type-check and lint**

```bash
npm run check && npm run lint
```

Expected: no errors or warnings.

- [ ] **Step 3: Commit**

```bash
git add src/lib/webrtc.ts tests/webrtc-visibility.test.ts
git commit -m "feat: stop collection on sleep/freeze, ignore desktop tab switches"
```

---

### Task 5: Manual smoke test

No automated test covers the real browser lifecycle. Verify:

- [ ] Run `npm run dev`, open `http://localhost:5173`, click **Start**
- [ ] **Desktop tab switch:** Switch to another tab for >30s. Return. Verify collection **continues** (probe count increased while hidden).
- [ ] **Laptop lid close:** Close the lid for >30s. Open. Verify green banner: *"Collection stopped — computer went to sleep"*
- [ ] **Grace period:** Switch tabs for <30s and return. Verify collection continues.
- [ ] **Manual stop during hide:** Start, switch tab, click Stop within the grace window. Verify *"Collection stopped manually"* (not the sleep message).
- [ ] **Mobile (if available):** Open on phone, start, switch apps for >30s, return. Verify green banner: *"Collection stopped — Cutie only works when visible"*
