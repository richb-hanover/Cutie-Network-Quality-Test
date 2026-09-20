import { describe, it, expect, beforeEach } from 'vitest';
import {
	connections,
	oldConnections,
	handleConnectionStateChange,
	type ManagedConnection
} from '../src/lib/server/webrtcRegistry';

// WebRTC reports 'disconnected' and then 'failed' when connectivity checks stop being
// answered. A frozen Safari tab went disconnected, then failed about 45 s after being
// hidden, and came back to 'connected' when the tab woke up (35 minutes later, once).
// So neither state ends a connection; 'closed' does, and the server timeout reaps the rest.
const ID = 'test-connection';
const TAG = '(01) ';

let logged: string[];
const log = (message: string) => logged.push(message);

function register(overrides: Partial<ManagedConnection> = {}): ManagedConnection {
	const managed: ManagedConnection = {
		id: ID,
		pc: {} as RTCPeerConnection,
		startedAt: new Date('2026-09-20T08:00:00'),
		reason: '',
		deleteReceived: false,
		openedAt: new Date('2026-09-20T08:00:01'),
		lastMessageAt: new Date('2026-09-20T08:00:24'),
		disconnectedAt: null,
		clientIp: '127.0.0.1',
		...overrides
	};
	connections.set(ID, managed);
	return managed;
}

function stateChange(connectionState: string, iceConnectionState = connectionState) {
	handleConnectionStateChange(
		ID,
		{ connectionState, iceConnectionState, iceGatheringState: 'complete' },
		TAG,
		log
	);
}

describe('server connection state changes', () => {
	beforeEach(() => {
		connections.clear();
		oldConnections.length = 0;
		logged = [];
	});

	it("keeps a 'disconnected' connection registered and says it may recover", () => {
		register();

		stateChange('disconnected');

		expect(connections.has(ID)).toBe(true);
		expect(oldConnections).toHaveLength(0);
		expect(logged).toHaveLength(1);
		expect(logged[0]).toContain('may recover');
		expect(logged[0]).toContain(ID);
		expect(logged[0]).not.toContain('UNEXPECTED');
	});

	it("keeps a 'failed' connection registered and says it may still recover", () => {
		register();

		stateChange('disconnected');
		stateChange('failed');

		expect(connections.has(ID)).toBe(true);
		expect(oldConnections).toHaveLength(0);
		expect(logged[1]).toContain('failed');
		expect(logged[1]).toContain('may still recover');
		expect(logged.join('\n')).not.toContain('UNEXPECTED');
	});

	it("finalizes a 'closed' connection and logs it as unexpected", () => {
		register();

		stateChange('closed');

		expect(connections.has(ID)).toBe(false);
		expect(oldConnections).toHaveLength(1);
		expect(oldConnections[0].id).toBe(ID);
		expect(logged.join('\n')).toContain('UNEXPECTED connection close');
		expect(logged.join('\n')).toContain('state=closed');
	});

	it('logs a close after a client DELETE as clean, not unexpected', () => {
		register({ deleteReceived: true });

		stateChange('closed');

		expect(connections.has(ID)).toBe(false);
		expect(logged.join('\n')).toContain('closed cleanly');
		expect(logged.join('\n')).not.toContain('UNEXPECTED');
	});

	it('logs recovery from disconnected, and again after a later failure', () => {
		register();

		stateChange('disconnected');
		stateChange('connected');
		expect(connections.has(ID)).toBe(true);
		expect(logged[1]).toContain('recovered');

		stateChange('disconnected');
		stateChange('failed');
		stateChange('connected');
		expect(connections.has(ID)).toBe(true);
		expect(logged[logged.length - 1]).toContain('recovered');
	});

	it("reports a first 'connected' as a plain state change, not a recovery", () => {
		register();

		stateChange('connected');

		expect(logged).toEqual([`${TAG}Connection state changed: id: ${ID} state: connected`]);
	});

	it('ignores state changes for a connection that was already removed', () => {
		stateChange('disconnected');
		stateChange('closed');

		expect(logged).toEqual([]);
		expect(oldConnections).toHaveLength(0);
	});
});
