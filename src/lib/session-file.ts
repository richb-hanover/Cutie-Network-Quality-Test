import type { LatencyStats } from '$lib/latency-probe';
import type { RecentAverages } from '$lib/stores/mosStore';

export type RawProbe = {
	seq: number;
	sentAt: number; // Unix ms
	receivedAt: number | null; // Unix ms, null = lost
};

export type SessionBounds = {
	latencyMs: { min: number | null; max: number | null };
	jitterMs: { min: number | null; max: number | null };
	packetLossPercent: { min: number | null; max: number | null };
	mos: { min: number | null; max: number | null };
};

export type SessionFileData = {
	version: string;
	sessionStartMs: number;
	connectionId: string | null;
	durationMs: number;
	latencyStats: LatencyStats;
	bounds: SessionBounds;
	tenSecondAverages: RecentAverages;
	tenSecondMos: number | null;
	bytesSent: number;
	probes: RawProbe[];
};

const n = (v: number | null): string => (v === null ? '' : String(v));
const parseN = (s: string): number | null => (s === '' || s === 'null' ? null : Number(s));

export function formatCutieFile(data: SessionFileData): string {
	const lines: string[] = [
		`# cutie v${data.version}`,
		`# session-start-ms=${data.sessionStartMs}`,
		`# connection-id=${data.connectionId ?? ''}`,
		`# duration-ms=${data.durationMs}`,
		`# last-latency-ms=${n(data.latencyStats.lastLatencyMs)}`,
		`# average-latency-ms=${n(data.latencyStats.averageLatencyMs)}`,
		`# jitter-ms=${n(data.latencyStats.jitterMs)}`,
		`# total-sent=${data.latencyStats.totalSent}`,
		`# total-received=${data.latencyStats.totalReceived}`,
		`# total-lost=${data.latencyStats.totalLost}`,
		`# bounds-latency-min=${n(data.bounds.latencyMs.min)}`,
		`# bounds-latency-max=${n(data.bounds.latencyMs.max)}`,
		`# bounds-jitter-min=${n(data.bounds.jitterMs.min)}`,
		`# bounds-jitter-max=${n(data.bounds.jitterMs.max)}`,
		`# bounds-loss-min=${n(data.bounds.packetLossPercent.min)}`,
		`# bounds-loss-max=${n(data.bounds.packetLossPercent.max)}`,
		`# bounds-mos-min=${n(data.bounds.mos.min)}`,
		`# bounds-mos-max=${n(data.bounds.mos.max)}`,
		`# ten-second-latency-ms=${n(data.tenSecondAverages.averageLatencyMs)}`,
		`# ten-second-jitter-ms=${n(data.tenSecondAverages.averageJitterMs)}`,
		`# ten-second-loss=${n(data.tenSecondAverages.packetLossPercent)}`,
		`# ten-second-mos=${n(data.tenSecondMos)}`,
		`# bytes-sent=${data.bytesSent}`,
		`seq,sentAt,receivedAt`
	];

	for (const p of data.probes) {
		lines.push(`${p.seq},${p.sentAt},${p.receivedAt ?? ''}`);
	}

	return lines.join('\n') + '\n';
}

export function parseCutieFile(content: string): SessionFileData {
	const lines = content.split('\n');
	const headers: Record<string, string> = {};
	const probes: RawProbe[] = [];
	let inData = false;
	let version = '';

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		if (trimmed.startsWith('seq,sentAt,receivedAt')) {
			inData = true;
			continue;
		}

		if (trimmed.startsWith('#')) {
			const body = trimmed.slice(1).trim();

			// Version line: "# cutie v0.2.21" (no = sign)
			const versionMatch = body.match(/^cutie v(.+)$/);
			if (versionMatch) {
				version = versionMatch[1];
				continue;
			}

			const eq = body.indexOf('=');
			if (eq !== -1) {
				headers[body.slice(0, eq).trim()] = body.slice(eq + 1).trim();
			}
			continue;
		}

		if (inData) {
			const parts = trimmed.split(',');
			if (parts.length < 2) continue;
			probes.push({
				seq: Number(parts[0]),
				sentAt: Number(parts[1]),
				receivedAt: parts[2] ? Number(parts[2]) : null
			});
		}
	}

	if (!headers['session-start-ms']) {
		throw new Error('Invalid .cutie file: missing session-start-ms');
	}

	return {
		version,
		sessionStartMs: Number(headers['session-start-ms']),
		connectionId: headers['connection-id'] || null,
		durationMs: Number(headers['duration-ms'] ?? 0),
		latencyStats: {
			lastLatencyMs: parseN(headers['last-latency-ms'] ?? ''),
			averageLatencyMs: parseN(headers['average-latency-ms'] ?? ''),
			jitterMs: parseN(headers['jitter-ms'] ?? ''),
			totalSent: Number(headers['total-sent'] ?? 0),
			totalReceived: Number(headers['total-received'] ?? 0),
			totalLost: Number(headers['total-lost'] ?? 0),
			history: []
		},
		bounds: {
			latencyMs: {
				min: parseN(headers['bounds-latency-min'] ?? ''),
				max: parseN(headers['bounds-latency-max'] ?? '')
			},
			jitterMs: {
				min: parseN(headers['bounds-jitter-min'] ?? ''),
				max: parseN(headers['bounds-jitter-max'] ?? '')
			},
			packetLossPercent: {
				min: parseN(headers['bounds-loss-min'] ?? ''),
				max: parseN(headers['bounds-loss-max'] ?? '')
			},
			mos: {
				min: parseN(headers['bounds-mos-min'] ?? ''),
				max: parseN(headers['bounds-mos-max'] ?? '')
			}
		},
		tenSecondAverages: {
			averageLatencyMs: parseN(headers['ten-second-latency-ms'] ?? ''),
			averageJitterMs: parseN(headers['ten-second-jitter-ms'] ?? ''),
			packetLossPercent: parseN(headers['ten-second-loss'] ?? '')
		},
		tenSecondMos: parseN(headers['ten-second-mos'] ?? ''),
		bytesSent: Number(headers['bytes-sent'] ?? 0),
		probes
	};
}

export function cutieFilename(sessionStartMs: number): string {
	const d = new Date(sessionStartMs);
	const pad = (x: number) => String(x).padStart(2, '0');
	const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
	return `Cutie_Results-${ts}.cutie`;
}

export async function downloadCutieFile(content: string, sessionStartMs: number): Promise<void> {
	const compressed = await new Response(
		new Blob([content]).stream().pipeThrough(new CompressionStream('gzip'))
	).blob();
	const url = URL.createObjectURL(compressed);
	const a = document.createElement('a');
	a.href = url;
	a.download = cutieFilename(sessionStartMs);
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

export async function decompressCutieFile(file: File): Promise<string> {
	return new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
}
