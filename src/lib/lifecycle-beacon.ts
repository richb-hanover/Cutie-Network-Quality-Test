// lifecycle-beacon.ts

import { getLogger } from './logger';
import { connectionIdStore } from './webrtc';
const logger = getLogger('beacon');

type BeaconReason =
	| 'init'
	| 'visibility-hidden'
	| 'visibility-visible'
	| 'pagehide-unload'
	| 'pagehide-bfcache'
	| 'pageshow-restore'
	| 'beforeunload'
	| 'unload';

interface BeaconPayload {
	reason: BeaconReason;
	ts: number;
	visibilityState: DocumentVisibilityState;
	url: string;
	pageLifecycleId: string;
	[key: string]: unknown;
}

const BEACON_URL = '/api/beacon';

const pageLifecycleId = Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
let latestConnectionId: string | null = null;

if (typeof window !== 'undefined') {
	const unsubscribe = connectionIdStore.subscribe((connectionId) => {
		latestConnectionId = connectionId;
	});
	window.addEventListener('unload', () => {
		unsubscribe();
	});
}

function sendLifecycleBeacon(reason: BeaconReason, extra: Record<string, unknown> = {}): void {
	const payload: BeaconPayload = {
		reason,
		ts: Date.now(),
		visibilityState: document.visibilityState,
		url: window.location.href,
		pageLifecycleId,
		...(latestConnectionId ? { connectionId: latestConnectionId } : {}),
		...extra
	};

	logger.info(`beacon: ${reason} ${JSON.stringify(extra)}`);

	const body = JSON.stringify(payload);
	const blob = new Blob([body], { type: 'application/json' });

	if (navigator.sendBeacon && navigator.sendBeacon(BEACON_URL, blob)) return;

	void fetch(BEACON_URL, {
		method: 'POST',
		body,
		headers: { 'Content-Type': 'application/json' },
		keepalive: true
	}).catch(() => {});
}

sendLifecycleBeacon('init');

// Lets the server log show when this window was hidden and when it became visible again,
// e.g. to see when a hidden Safari tab lost its connection.
document.addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'hidden') {
		sendLifecycleBeacon('visibility-hidden');
	} else {
		sendLifecycleBeacon('visibility-visible');
	}
});

window.addEventListener('pagehide', (event) => {
	const e = event as PageTransitionEvent;
	if (e.persisted) {
		sendLifecycleBeacon('pagehide-bfcache', { persisted: true });
	} else {
		sendLifecycleBeacon('pagehide-unload', { persisted: false });
	}
});

window.addEventListener('pageshow', (event) => {
	const e = event as PageTransitionEvent;
	if (e.persisted) {
		sendLifecycleBeacon('pageshow-restore', { persisted: true });
	}
});

window.addEventListener('beforeunload', () => {
	sendLifecycleBeacon('beforeunload');
});

window.addEventListener('unload', () => {
	sendLifecycleBeacon('unload');
});
