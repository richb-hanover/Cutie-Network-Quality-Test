// Helpers for handling a Cutie page that was hidden (other tab, covered window,
// closed lid) or the whole machine slept. Browsers throttle or freeze hidden pages,
// so probes arrive far below the normal 10 per second — sometimes not at all. See
// docs/Browser Background Behavior.md for the measurements behind these numbers.

/** A hide shorter than this (or exactly this) never triggers a stop. */
export const BACKGROUND_STOP_MIN_HIDDEN_MS = 30_000;
/** Probes per second that Chrome, Edge and Firefox keep sending while hidden. */
export const THROTTLED_PROBES_PER_SECOND = 1;
/** Stop collection when fewer than this fraction of the throttled probes arrived. */
export const BACKGROUND_STOP_RATE_FRACTION = 0.5;
/** After the page becomes visible, a lost connection still counts as "in the background". */
export const BACKGROUND_GRACE_MS = 10_000;

/**
 * The single message shown for any stop caused by backgrounding: too few probes
 * arrived while hidden, or the connection itself failed while hidden. There is no
 * reliable way to tell a covered/backgrounded tab apart from the machine actually
 * sleeping, so both read the same way.
 */
export const BACKGROUND_STOP_MESSAGE = 'Collection stopped because Cutie was in the background';

/**
 * shouldStopForBackground() - decide, on return from a hide (or an unexpected
 * connection failure while hidden), whether so few probes arrived that the data
 * collected since is useless and collection should stop.
 * @param hiddenMs - how long the page was hidden
 * @param receivedWhileHidden - probes received during that time
 */
export function shouldStopForBackground(hiddenMs: number, receivedWhileHidden: number): boolean {
	if (hiddenMs <= BACKGROUND_STOP_MIN_HIDDEN_MS) {
		return false;
	}
	const expected = (hiddenMs / 1000) * THROTTLED_PROBES_PER_SECOND;
	return receivedWhileHidden < expected * BACKGROUND_STOP_RATE_FRACTION;
}

/**
 * applyTwoHourRule() - a stop that happens after the two-hour limit is reported as
 * the two-hour stop, whatever the event order on wake-up was.
 * Manual stops, reloads and the two-hour stop itself keep their own reason.
 */
export function applyTwoHourRule<T extends string>(
	reason: T,
	elapsedMs: number | null,
	limitMs: number
): T | 'auto' {
	if (
		(reason === 'error' || reason === 'timeout' || reason === 'background') &&
		elapsedMs !== null &&
		elapsedMs >= limitMs
	) {
		return 'auto';
	}
	return reason;
}

/**
 * wasInBackground() - true while a hide is recorded, or for a short time after the
 * page became visible again (events can arrive in either order on wake-up).
 */
export function wasInBackground(times: {
	hiddenAt: number | null;
	lastShownAt: number | null;
	now: number;
}): boolean {
	if (times.hiddenAt !== null) {
		return true;
	}
	return times.lastShownAt !== null && times.now - times.lastShownAt <= BACKGROUND_GRACE_MS;
}
