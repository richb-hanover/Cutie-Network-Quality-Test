import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	shouldShowSamplesNotice,
	applyTwoHourRule,
	withBackgroundContext,
	wasInBackground,
	createTransientNotice
} from '../src/lib/background-gap';

// Expected values below are hand-derived from the measurements in
// docs/Browser Background Behavior.md, not computed by the code under test.
describe('shouldShowSamplesNotice', () => {
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
		expect(shouldShowSamplesNotice(hiddenMs, received)).toBe(expected);
	});
});

describe('applyTwoHourRule', () => {
	const limit = 7_200_000;
	const cases: Array<[string, string, number | null, string]> = [
		// [description, reason in, elapsedMs, reason out]
		['error at exactly two hours becomes auto', 'error', 7_200_000, 'auto'],
		['timeout after two hours becomes auto', 'timeout', 8_000_000, 'auto'],
		['error one ms before two hours stays error', 'error', 7_199_999, 'error'],
		['manual stop after two hours stays manual', 'manual', 8_000_000, 'manual'],
		['auto stays auto', 'auto', 8_000_000, 'auto'],
		['reload after two hours stays reload', 'reload', 8_000_000, 'reload'],
		['error with no known start time stays error', 'error', null, 'error']
	];

	it.each(cases)('%s', (_name, reason, elapsedMs, expected) => {
		expect(applyTwoHourRule(reason, elapsedMs, limit)).toBe(expected);
	});
});

describe('withBackgroundContext', () => {
	it('adds background context to a lost-connection message', () => {
		expect(withBackgroundContext('Lost connection to the server...', true)).toBe(
			'Lost connection to the server while Cutie was in the background'
		);
	});

	it('leaves a lost-connection message alone when not in the background', () => {
		expect(withBackgroundContext('Lost connection to the server...', false)).toBe(
			'Lost connection to the server...'
		);
	});

	it('leaves other error messages alone even in the background', () => {
		expect(
			withBackgroundContext("Can't connect to the server when the network is down", true)
		).toBe("Can't connect to the server when the network is down");
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

describe('createTransientNotice', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('shows the text, then clears it after 15 s', () => {
		vi.useFakeTimers();
		const seen: Array<string | null> = [];
		const notice = createTransientNotice((text) => seen.push(text), 15_000);

		notice.show('hello');
		expect(seen).toEqual(['hello']);

		vi.advanceTimersByTime(14_999);
		expect(seen).toEqual(['hello']);

		vi.advanceTimersByTime(1);
		expect(seen).toEqual(['hello', null]);
	});

	it('a second show restarts the timer so the old timer cannot clear the new notice', () => {
		vi.useFakeTimers();
		const seen: Array<string | null> = [];
		const notice = createTransientNotice((text) => seen.push(text), 15_000);

		notice.show('first');
		vi.advanceTimersByTime(10_000);
		notice.show('second');
		vi.advanceTimersByTime(10_000); // 20 s after first, 10 s after second
		expect(seen).toEqual(['first', 'second']);

		vi.advanceTimersByTime(5_000); // 15 s after second
		expect(seen).toEqual(['first', 'second', null]);
	});

	it('clear() removes the notice at once and cancels the pending timer', () => {
		vi.useFakeTimers();
		const seen: Array<string | null> = [];
		const notice = createTransientNotice((text) => seen.push(text), 15_000);

		notice.show('hello');
		notice.clear();
		expect(seen).toEqual(['hello', null]);

		vi.advanceTimersByTime(60_000);
		expect(seen).toEqual(['hello', null]);
	});
});
