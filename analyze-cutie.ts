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
