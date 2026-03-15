#!/usr/bin/env npx tsx
import { gunzipSync } from 'zlib';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { calculateMosScore } from './src/lib/stores/mosStore';
import type { RawProbe } from './src/lib/session-file';

export function formatTime(ms: number): string {
	const d = new Date(ms);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export type ProbeLine = {
	raw: string;
	probe: RawProbe;
};

export type ParsedCutie = {
	headerLines: string[];
	probeLines: ProbeLine[];
};

export type Summary = {
	probeIndex: number;          // index into probes array (= index into probeLines)
	tTick: number;               // absolute Unix ms of the tick
	time: string;                // HH:MM:SS wall-clock
	mos: number | null;
	packetLossPercent: number | null;
	avgLatencyMs: number | null;
	avgJitterMs: number | null;
};

export function computeSummaries(probes: RawProbe[]): Summary[] {
	if (probes.length === 0) return [];

	const TEN_S = 10_000;
	const origin = probes[0].sentAt;
	const lastSentAt = probes[probes.length - 1].sentAt;
	const totalTicks = Math.ceil((lastSentAt - origin) / TEN_S) + 1;

	const summaries: Summary[] = [];

	for (let k = 1; k <= totalTicks; k++) {
		const tTick = origin + k * TEN_S;

		// Rolling window: probes sent within the previous 10 seconds
		const window = probes.filter((p) => p.sentAt >= tTick - TEN_S && p.sentAt < tTick);
		if (window.length === 0) continue;

		// Last probe before this tick — the line we'll annotate in the CSV
		let lastIdx = -1;
		for (let i = probes.length - 1; i >= 0; i--) {
			if (probes[i].sentAt < tTick) {
				lastIdx = i;
				break;
			}
		}
		if (lastIdx === -1) continue;

		// Compute stats from window
		const received = window.filter((p) => p.receivedAt !== null);
		const lost = window.length - received.length;
		const packetLossPercent = (lost / window.length) * 100;

		let latencySum = 0;
		let jitterSum = 0;
		let prevLatency: number | null = null;

		for (const p of received) {
			const latency = p.receivedAt! - p.sentAt;
			latencySum += latency;
			if (prevLatency !== null) {
				jitterSum += Math.abs(latency - prevLatency);
			}
			prevLatency = latency;
		}

		const avgLatencyMs = received.length > 0 ? latencySum / received.length : null;
		const avgJitterMs = received.length > 1 ? jitterSum / (received.length - 1) : null;
		const mos = calculateMosScore(avgLatencyMs, avgJitterMs, packetLossPercent);

		summaries.push({
			probeIndex: lastIdx,
			tTick,
			time: formatTime(tTick),
			mos,
			packetLossPercent,
			avgLatencyMs,
			avgJitterMs,
		});
	}

	return summaries;
}

const fmt = (v: number | null): string => (v === null ? '' : v.toFixed(2));

export function buildCsvLines(
	headerLines: string[],
	probeLines: ProbeLine[],
	summaries: Summary[]
): string[] {
	const summaryByIndex = new Map<number, Summary>(summaries.map((s) => [s.probeIndex, s]));

	const lines: string[] = [
		...headerLines,
		'seq,sentAt,receivedAt,time,mos,packet_loss_pct,avg_latency_ms,avg_jitter_ms',
	];

	for (let i = 0; i < probeLines.length; i++) {
		const s = summaryByIndex.get(i);
		if (s) {
			lines.push(
				`${probeLines[i].raw},${s.time},${fmt(s.mos)},${fmt(s.packetLossPercent)},${fmt(s.avgLatencyMs)},${fmt(s.avgJitterMs)}`
			);
		} else {
			lines.push(probeLines[i].raw);
		}
	}

	return lines;
}

export function parseCutieLines(content: string): ParsedCutie {
	const headerLines: string[] = [];
	const probeLines: ProbeLine[] = [];
	let inData = false;

	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		if (trimmed.startsWith('seq,sentAt,receivedAt')) {
			inData = true;
			continue;
		}

		if (trimmed.startsWith('#')) {
			headerLines.push(line);
			continue;
		}

		if (inData) {
			const parts = trimmed.split(',');
			if (parts.length < 2) continue;
			probeLines.push({
				raw: line,
				probe: {
					seq: Number(parts[0]),
					sentAt: Number(parts[1]),
					receivedAt: parts[2] ? Number(parts[2]) : null,
				},
			});
		}
	}

	return { headerLines, probeLines };
}

function main(): void {
	const inputPath = process.argv[2];
	if (!inputPath) {
		console.error('Usage: analyze-cutie <file.cutie>');
		process.exit(1);
	}

	const absInput = resolve(inputPath);
	const compressed = readFileSync(absInput);
	const content = gunzipSync(compressed).toString('utf8');

	const { headerLines, probeLines } = parseCutieLines(content);
	const probes = probeLines.map((pl) => pl.probe);
	const summaries = computeSummaries(probes);
	const lines = buildCsvLines(headerLines, probeLines, summaries);

	const outputPath = absInput.replace(/\.cutie$/, '.csv');
	writeFileSync(outputPath, lines.join('\n') + '\n');
	console.log(`Written to ${outputPath}`);
}

// Only run when executed directly (not when imported by tests)
import { fileURLToPath } from 'url';
import { realpathSync } from 'fs';
if (realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
	main();
}
