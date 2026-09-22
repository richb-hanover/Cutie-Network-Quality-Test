// Safari is the one desktop browser (of the four Cutie supports) that stops
// collecting almost entirely as soon as its window is covered or backgrounded
// (see docs/Browser Background Behavior.md). There's no feature-detection API for
// this, so we fall back to sniffing the user agent string.

/**
 * isSafari() - true for Safari, false for Chrome, Edge and Firefox (all of which
 * also contain the substring "Safari" in their own user agent strings).
 */
export function isSafari(userAgent: string | null): boolean {
	if (!userAgent) {
		return false;
	}
	return /Safari/.test(userAgent) && !/Chrome|Chromium|Edg\//.test(userAgent);
}
