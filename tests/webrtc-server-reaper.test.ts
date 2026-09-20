import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	connections,
	oldConnections,
	reapExpiredConnections,
	startConnectionReaper,
	type ManagedConnection
} from '../src/lib/server/webrtcRegistry';
import { GET as getStats } from '../src/routes/api/stats/+server';

// Earlier versions left sessions alive for days. Every connection is closed once it is
// 2 h 10 min old (a Cutie session stops itself at 2 h), whatever state it is in.
const TWO_HOURS_TEN_MS = 7_800_000; // written out by hand, not taken from the code under test
const START = new Date('2026-09-20T08:00:00');
const REASON = 'Server timeout after 2h10m';

let logged: string[];
const log = (message: string) => logged.push(message);

function register(id: string, startedAt: Date, closeImpl: () => void = () => {}) {
	const close = vi.fn(closeImpl);
	const managed: ManagedConnection = {
		id,
		pc: { close } as unknown as RTCPeerConnection,
		startedAt,
		reason: '',
		deleteReceived: false,
		openedAt: startedAt,
		lastMessageAt: null,
		disconnectedAt: null,
		clientIp: '192.168.253.108'
	};
	connections.set(id, managed);
	return close;
}

function at(msAfterStart: number): Date {
	return new Date(START.getTime() + msAfterStart);
}

describe('server connection timeout', () => {
	beforeEach(() => {
		connections.clear();
		oldConnections.length = 0;
		logged = [];
	});

	it('closes and finalizes a connection that is 2 h 10 min old, with a distinct reason', () => {
		const close = register('old', START);

		const reaped = reapExpiredConnections(at(TWO_HOURS_TEN_MS), log);

		expect(reaped).toEqual(['old']);
		expect(close).toHaveBeenCalledOnce();
		expect(connections.has('old')).toBe(false);
		expect(oldConnections).toHaveLength(1);
		expect(oldConnections[0].reason).toBe(REASON);
		expect(logged.join('\n')).toContain('old');
	});

	it('leaves a connection alone one millisecond before 2 h 10 min', () => {
		const close = register('young', START);

		const reaped = reapExpiredConnections(at(TWO_HOURS_TEN_MS - 1), log);

		expect(reaped).toEqual([]);
		expect(close).not.toHaveBeenCalled();
		expect(connections.has('young')).toBe(true);
	});

	it('reaps only the connections that are old enough', () => {
		register('old', START);
		register('young', at(30 * 60_000)); // started 30 minutes later

		const reaped = reapExpiredConnections(at(TWO_HOURS_TEN_MS + 1), log);

		expect(reaped).toEqual(['old']);
		expect([...connections.keys()]).toEqual(['young']);
	});

	it('still finalizes the connection if closing the peer throws', () => {
		register('stubborn', START, () => {
			throw new Error('already closed');
		});

		const reaped = reapExpiredConnections(at(TWO_HOURS_TEN_MS), log);

		expect(reaped).toEqual(['stubborn']);
		expect(connections.has('stubborn')).toBe(false);
		expect(oldConnections[0].reason).toBe(REASON);
	});

	it('shows the timeout reason for the connection in /api/stats', async () => {
		register('old', START);
		reapExpiredConnections(at(TWO_HOURS_TEN_MS), log);

		const response = await getStats({} as Parameters<typeof getStats>[0]);
		const stats = await response.json();

		expect(stats.currentConnections).toBe(0);
		expect(stats.oldConnections).toHaveLength(1);
		expect(stats.oldConnections[0].connectionId).toContain('old');
		expect(stats.oldConnections[0].reason).toBe(REASON);
	});
});

describe('server connection timeout schedule', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		connections.clear();
		oldConnections.length = 0;
		logged = [];
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('checks for expired connections once a minute', () => {
		vi.setSystemTime(START);
		register('old', START);
		startConnectionReaper(log);

		vi.setSystemTime(at(TWO_HOURS_TEN_MS + 1));
		vi.advanceTimersByTime(59_000);
		expect(connections.has('old')).toBe(true); // not checked yet

		vi.advanceTimersByTime(1_000);
		expect(connections.has('old')).toBe(false);
		expect(oldConnections[0].reason).toBe(REASON);
	});
});
