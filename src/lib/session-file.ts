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
	backendAddress: string | null;
	durationMs: number;
	latencyStats: LatencyStats;
	bounds: SessionBounds;
	tenSecondAverages: RecentAverages;
	tenSecondMos: number | null;
	mosInstant: number | null;
	bytesSent: number;
	probes: RawProbe[];
};

const n = (v: number | null): string => (v === null ? '' : String(v));
const parseN = (s: string): number | null => (s === '' || s === 'null' ? null : Number(s));

export function formatCutieFile(data: SessionFileData): string {
	const totalLossPct =
		data.latencyStats.totalSent > 0
			? (data.latencyStats.totalLost / data.latencyStats.totalSent) * 100
			: null;

	const lines: string[] = [
		`# cutie v${data.version}`,
		`# session-start: ${new Date(data.sessionStartMs).toISOString()}`,
		`# connection-id: ${data.connectionId ?? ''}`,
		`# backend: ${data.backendAddress ?? ''}`,
		`# duration-ms: ${data.durationMs}`,
		`#`,
		`# [latency-monitor]`,
		`# mos-instant=${n(data.mosInstant)},mos-10s=${n(data.tenSecondMos)},mos-min=${n(data.bounds.mos.min)},mos-max=${n(data.bounds.mos.max)}`,
		`# latency-ms=${n(data.latencyStats.lastLatencyMs)},latency-10s=${n(data.tenSecondAverages.averageLatencyMs)},latency-min=${n(data.bounds.latencyMs.min)},latency-max=${n(data.bounds.latencyMs.max)}`,
		`# jitter-ms=${n(data.latencyStats.jitterMs)},jitter-10s=${n(data.tenSecondAverages.averageJitterMs)},jitter-min=${n(data.bounds.jitterMs.min)},jitter-max=${n(data.bounds.jitterMs.max)}`,
		`# packet-loss=${n(totalLossPct)},loss-10s=${n(data.tenSecondAverages.packetLossPercent)},loss-min=${n(data.bounds.packetLossPercent.min)},loss-max=${n(data.bounds.packetLossPercent.max)}`,
		`#`,
		`# [long-term-stats]`,
		`# total-sent=${data.latencyStats.totalSent},total-received=${data.latencyStats.totalReceived},total-lost=${data.latencyStats.totalLost}`,
		`# bytes-sent=${data.bytesSent},elapsed-ms=${data.durationMs}`,
		`#`,
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
			if (!body) continue;

			// Section headers: [latency-monitor], [long-term-stats]
			if (body.startsWith('[') && body.endsWith(']')) continue;

			// Version line: "cutie v0.2.21"
			const versionMatch = body.match(/^cutie v(.+)$/);
			if (versionMatch) {
				version = versionMatch[1];
				continue;
			}

			// "key: value" format (new top-level fields)
			const colonIdx = body.indexOf(': ');
			if (colonIdx !== -1) {
				headers[body.slice(0, colonIdx).trim()] = body.slice(colonIdx + 2).trim();
				continue;
			}

			// "key=v1,key=v2,..." format (section data — may be comma-separated pairs)
			if (body.includes('=')) {
				for (const pair of body.split(',')) {
					const eq = pair.indexOf('=');
					if (eq !== -1) {
						headers[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
					}
				}
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

	if (!headers['session-start']) {
		throw new Error('Invalid .cutie file: missing session-start');
	}

	return {
		version,
		sessionStartMs: new Date(headers['session-start']).getTime(),
		connectionId: headers['connection-id'] || null,
		backendAddress: headers['backend'] || null,
		durationMs: Number(headers['duration-ms'] ?? 0),
		latencyStats: {
			lastLatencyMs: parseN(headers['latency-ms'] ?? ''),
			averageLatencyMs: null,
			jitterMs: parseN(headers['jitter-ms'] ?? ''),
			totalSent: Number(headers['total-sent'] ?? 0),
			totalReceived: Number(headers['total-received'] ?? 0),
			totalLost: Number(headers['total-lost'] ?? 0),
			history: []
		},
		bounds: {
			latencyMs: {
				min: parseN(headers['latency-min'] ?? ''),
				max: parseN(headers['latency-max'] ?? '')
			},
			jitterMs: {
				min: parseN(headers['jitter-min'] ?? ''),
				max: parseN(headers['jitter-max'] ?? '')
			},
			packetLossPercent: {
				min: parseN(headers['loss-min'] ?? ''),
				max: parseN(headers['loss-max'] ?? '')
			},
			mos: {
				min: parseN(headers['mos-min'] ?? ''),
				max: parseN(headers['mos-max'] ?? '')
			}
		},
		tenSecondAverages: {
			averageLatencyMs: parseN(headers['latency-10s'] ?? ''),
			averageJitterMs: parseN(headers['jitter-10s'] ?? ''),
			packetLossPercent: parseN(headers['loss-10s'] ?? '')
		},
		tenSecondMos: parseN(headers['mos-10s'] ?? ''),
		mosInstant: parseN(headers['mos-instant'] ?? ''),
		bytesSent: Number(headers['bytes-sent'] ?? 0),
		probes
	};
}

export function formatLocalDateTime(ms: number): string {
	const d = new Date(ms);
	const day = String(d.getDate()).padStart(2, '0');
	const month = String(d.getMonth() + 1).padStart(2, '0');
	const year = String(d.getFullYear()).slice(-2);
	const hours = d.getHours();
	const ampm = hours >= 12 ? 'PM' : 'AM';
	const hh = String(hours % 12 || 12).padStart(2, '0');
	const mm = String(d.getMinutes()).padStart(2, '0');
	const ss = String(d.getSeconds()).padStart(2, '0');
	return `${day}/${month}/${year}, ${hh}:${mm}:${ss} ${ampm}`;
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
