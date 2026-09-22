import { describe, it, expect } from 'vitest';
import {
	shouldStopForBackground,
	applyTwoHourRule,
	wasInBackground,
	BACKGROUND_STOP_MESSAGE
} from '../src/lib/background-gap';

// Expected values below are hand-derived from the measurements in
// docs/Browser Background Behavior.md, not computed by the code under test.
describe('shouldStopForBackground', () => {
	const cases: Array<[string, number, number, boolean]> = [
		// [description, hiddenMs, probes received while hidden, expected]
		['Firefox lid closed (68% of 1/s)', 476_000, 326, false],
		['Firefox hidden (95% of 1/s)', 468_900, 445, false],
		['Chrome hidden (100% of 1/s)', 446_500, 447, false],
		['Edge hidden (100% of 1/s)', 277_800, 278, false],
		['Safari hidden 514 s (9 probes)', 514_500, 9, true],
		['Safari tab switch 359 s (9 probes)', 359_300, 9, true],
		['Safari covered 180 s (12 probes)', 179_500, 12, true],
		['Safari lid closed 28 min (21 probes)', 1_669_900, 21, true],
		['hidden exactly 30 s is not "more than 30 s"', 30_000, 0, false],
		['hidden 30.001 s with no probes', 30_001, 0, true],
		['hidden 29.999 s with no probes', 29_999, 0, false],
		['60 s hidden, exactly half of 60 expected arrived', 60_000, 30, false],
		['60 s hidden, one under half of 60 expected arrived', 60_000, 29, true]
	];

	it.each(cases)('%s', (_name, hiddenMs, received, expected) => {
		expect(shouldStopForBackground(hiddenMs, received)).toBe(expected);
	});
});

describe('BACKGROUND_STOP_MESSAGE', () => {
	it('is the single generic message for any background-caused stop', () => {
		expect(BACKGROUND_STOP_MESSAGE).toBe('Collection stopped because Cutie was in the background');
	});
});

describe('applyTwoHourRule', () => {
	const limit = 7_200_000;
	const cases: Array<[string, string, number | null, string]> = [
		// [description, reason in, elapsedMs, reason out]
		['error at exactly two hours becomes auto', 'error', 7_200_000, 'auto'],
		['timeout after two hours becomes auto', 'timeout', 8_000_000, 'auto'],
		['background after two hours becomes auto', 'background', 8_000_000, 'auto'],
		['error one ms before two hours stays error', 'error', 7_199_999, 'error'],
		['background one ms before two hours stays background', 'background', 7_199_999, 'background'],
		['manual stop after two hours stays manual', 'manual', 8_000_000, 'manual'],
		['auto stays auto', 'auto', 8_000_000, 'auto'],
		['reload after two hours stays reload', 'reload', 8_000_000, 'reload'],
		['error with no known start time stays error', 'error', null, 'error']
	];

	it.each(cases)('%s', (_name, reason, elapsedMs, expected) => {
		expect(applyTwoHourRule(reason, elapsedMs, limit)).toBe(expected);
	});
});

describe('wasInBackground', () => {
	const now = 1_000_000;

	it('is true while a hide is recorded and the show handler has not run yet', () => {
		expect(wasInBackground({ hiddenAt: now - 200_000, lastShownAt: null, now })).toBe(true);
	});

	it('is true just after the page became visible again', () => {
		expect(wasInBackground({ hiddenAt: null, lastShownAt: now - 5_000, now })).toBe(true);
	});

	it('is false once the page has been visible for more than 10 s', () => {
		expect(wasInBackground({ hiddenAt: null, lastShownAt: now - 10_001, now })).toBe(false);
	});

	it('is false when the page was never hidden', () => {
		expect(wasInBackground({ hiddenAt: null, lastShownAt: null, now })).toBe(false);
	});
});
