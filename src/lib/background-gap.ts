// Helpers for handling a Cutie page that was hidden (other tab, covered window,
// closed lid). Browsers throttle or freeze hidden pages, so probes arrive far
// below the normal 10 per second. See docs/Browser Background Behavior.md for the
// measurements behind these numbers.

/** A hide shorter than this (or exactly this) never triggers the notice. */
export const NOTICE_MIN_HIDDEN_MS = 30_000;
/** How long the yellow notice stays on screen. */
export const NOTICE_DURATION_MS = 15_000;
/** Probes per second that Chrome, Edge and Firefox keep sending while hidden. */
export const THROTTLED_PROBES_PER_SECOND = 1;
/** Show the notice when fewer than this fraction of the throttled probes arrived. */
export const NOTICE_RATE_FRACTION = 0.5;
/** After the page becomes visible, a lost connection still counts as "in the background". */
export const BACKGROUND_GRACE_MS = 10_000;

export const SAMPLES_NOTICE_TEXT =
	'Some samples were not collected while Cutie was in the background';

/**
 * shouldShowSamplesNotice() - decide, on return from a hide, whether so few probes
 * arrived that the user should be told.
 * @param hiddenMs - how long the page was hidden
 * @param receivedWhileHidden - probes received during that time
 */
export function shouldShowSamplesNotice(hiddenMs: number, receivedWhileHidden: number): boolean {
	if (hiddenMs <= NOTICE_MIN_HIDDEN_MS) {
		return false;
	}
	const expected = (hiddenMs / 1000) * THROTTLED_PROBES_PER_SECOND;
	return receivedWhileHidden < expected * NOTICE_RATE_FRACTION;
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
	if ((reason === 'error' || reason === 'timeout') && elapsedMs !== null && elapsedMs >= limitMs) {
		return 'auto';
	}
	return reason;
}

/**
 * withBackgroundContext() - say that a lost connection happened while Cutie was in
 * the background. Other error messages are left as they are.
 */
export function withBackgroundContext(message: string, inBackground: boolean): string {
	if (!inBackground || !message.startsWith('Lost connection')) {
		return message;
	}
	return `${message.replace(/\.+$/, '')} while Cutie was in the background`;
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

/**
 * createTransientNotice() - show a message and remove it after durationMs.
 * Showing again cancels the pending removal so an old timer cannot clear a newer
 * notice.
 */
export function createTransientNotice(
	setNotice: (text: string | null) => void,
	durationMs: number
): { show: (text: string) => void; clear: () => void } {
	let timer: ReturnType<typeof setTimeout> | null = null;

	const cancel = () => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	};

	return {
		show(text: string) {
			cancel();
			setNotice(text);
			timer = setTimeout(() => {
				timer = null;
				setNotice(null);
			}, durationMs);
		},
		clear() {
			cancel();
			setNotice(null);
		}
	};
}
