import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initializeLatencyMonitor, type LatencySample } from '../src/lib/latency-probe';

// When a page is frozen (Safari hidden tab, sleep), probes in flight look "lost" the moment
// the page wakes, because their 2 s deadline passed while nothing was running. Those are not
// network losses and must not be counted. Probes lost while the page was running still count.
// The clock is passed in, so a stall can be simulated by moving it without running timers.
let clock: number;
let samples: LatencySample[];

const channel = { readyState: 'open', send: vi.fn() } as unknown as RTCDataChannel;

function startMonitor() {
	const monitor = initializeLatencyMonitor({
		now: () => clock,
		onSamples: (batch) => samples.push(...batch)
	});
	monitor.start(channel);
	return monitor;
}

/** Runs the timers normally: the clock and the fake timers advance together. */
function runNormally(ms: number) {
	for (let elapsed = 0; elapsed < ms; elapsed += 50) {
		clock += 50;
		vi.advanceTimersByTime(50);
	}
}

/** The page is frozen for stallMs, then wakes and the timers fire once. */
function freezeThenWake(stallMs: number) {
	clock += stallMs;
	vi.advanceTimersByTime(300);
}

describe('probes pending across a stalled page', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		clock = 0;
		samples = [];
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('does not count probes as lost that only expired because the page was frozen', () => {
		const monitor = startMonitor();
		runNormally(500); // a few probes sent, none answered yet

		freezeThenWake(60_000);

		expect(monitor.getStats().totalLost).toBe(0);
		expect(samples.filter((s) => s.status === 'lost')).toHaveLength(0);
		monitor.stop();
	});

	it('still counts probes as lost when the page kept running and no echo came back', () => {
		const monitor = startMonitor();

		runNormally(3_000);

		expect(monitor.getStats().totalLost).toBeGreaterThan(0);
		monitor.stop();
	});

	it('counts probes sent after the wake-up as lost if they are never answered', () => {
		const monitor = startMonitor();
		runNormally(500);
		freezeThenWake(60_000);
		expect(monitor.getStats().totalLost).toBe(0);

		runNormally(3_000); // page is running again; nothing comes back

		expect(monitor.getStats().totalLost).toBeGreaterThan(0);
		monitor.stop();
	});

	it('ignores the late echo of a probe it already forgave', () => {
		const monitor = startMonitor();
		freezeThenWake(60_000); // probe 0 was sent at the start and is forgiven here

		const handled = monitor.handleMessage(
			JSON.stringify({ type: 'latency-probe', seq: 0, sentAt: 0 })
		);

		expect(handled).toBe(true);
		expect(monitor.getStats().totalReceived).toBe(0);
		monitor.stop();
	});
});
