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
