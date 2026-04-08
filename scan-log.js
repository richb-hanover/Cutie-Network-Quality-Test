#!/usr/bin/env node
// scan-log.js — Summarize a Cutie server log file
// Usage: node scan-log.js [filename-in-logs-dir]
// Default: newest .txt file in logs/

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(SCRIPT_DIR, 'logs');

function findNewestLog() {
	const files = readdirSync(LOGS_DIR)
		.filter((f) => f.endsWith('.txt') || f.endsWith('.log'))
		.map((f) => {
			const fullPath = join(LOGS_DIR, f);
			return { name: f, path: fullPath, mtime: statSync(fullPath).mtimeMs };
		})
		.sort((a, b) => b.mtime - a.mtime);

	if (files.length === 0) {
		console.error('No log files found in', LOGS_DIR);
		process.exit(1);
	}
	return files[0];
}

function increment(map, key) {
	map.set(key, (map.get(key) ?? 0) + 1);
}

function scanLog(logPath) {
	const lines = readFileSync(logPath, 'utf8').split('\n');

	const ipCounts = new Map(); // ip → request count
	const disconnectReasons = new Map(); // reason label → count
	let count404 = 0;
	const paths404 = new Map(); // path → count
	const ips404 = new Map(); // ip → count
	let beaconCount = 0;
	const beaconReasons = new Map(); // reason value → count

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// ── All IP addresses seen in HTTP requests ───────────────────────
		const httpMatch = line.match(/Received http \w+ from ([\d.]+) for /);
		if (httpMatch) {
			increment(ipCounts, httpMatch[1]);
		}

		// ── Disconnection reasons ────────────────────────────────────────
		// Explicit stop with a reason (e.g. "manual", "error", "2hr-timeout")
		const stopMatch = line.match(/Clicked Stop button - reason:\s*(\S+)/);
		if (stopMatch) {
			increment(disconnectReasons, `stop:${stopMatch[1]}`);
		}

		// New log format: single-line terminal state
		const stateEndedMatch = line.match(/Connection state ended: state:\s*(\S+)/);
		if (stateEndedMatch) {
			increment(disconnectReasons, `state-ended:${stateEndedMatch[1]}`);
		}

		// Old log format: multi-line "Connection state changed { state: 'failed' ... }"
		// Only count terminal states (failed / closed), not transient ones.
		if (line.includes('Connection state changed {')) {
			// Look ahead up to 5 lines for the state field
			for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
				const stateLineMatch = lines[j].match(/state:\s*'(failed|closed)'/);
				if (stateLineMatch) {
					increment(disconnectReasons, `state-changed:${stateLineMatch[1]}`);
					break;
				}
				if (lines[j].trim() === '}') break; // end of block
			}
		}

		// ── 404 responses ────────────────────────────────────────────────
		const status404Match = line.match(/Completed http \w+ from ([\d.]+) for (.+?) status 404/);
		if (status404Match) {
			count404++;
			increment(ips404, status404Match[1]);
			increment(paths404, status404Match[2].trim());
		}

		// ── /api/beacon requests ─────────────────────────────────────────
		// The beacon JSON is logged on the very next line after the "Received" line.
		if (line.includes('for /api/beacon')) {
			const nextLine = lines[i + 1] ?? '';
			if (nextLine.includes('server-beacon')) {
				beaconCount++;
				const reasonMatch = nextLine.match(/"reason"\s*:\s*"([^"]+)"/);
				if (reasonMatch) {
					increment(beaconReasons, reasonMatch[1]);
				}
			}
		}
	}

	return {
		ipCounts,
		disconnectReasons,
		count404,
		paths404,
		ips404,
		beaconCount,
		beaconReasons
	};
}

// ── Output helpers ─────────────────────────────────────────────────────────────

function printMap(map) {
	if (map.size === 0) {
		console.log('    (none)');
		return;
	}
	const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
	for (const [key, count] of sorted) {
		console.log(`    ${String(count).padStart(5)}  ${key}`);
	}
}

function section(title) {
	console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 56 - title.length))}`);
}

// ── Main ───────────────────────────────────────────────────────────────────────

const arg = process.argv[2];
let logPath, logName;

if (arg) {
	logPath = resolve(LOGS_DIR, arg);
	logName = arg;
} else {
	const newest = findNewestLog();
	logPath = newest.path;
	logName = newest.name;
}

console.log(`\nScanning: ${logName}`);
console.log('═'.repeat(60));

const s = scanLog(logPath);

const totalRequests = [...s.ipCounts.values()].reduce((sum, n) => sum + n, 0);
section(`IP addresses  (${s.ipCounts.size} unique, ${totalRequests} total requests)`);
printMap(s.ipCounts);

section('Disconnection reasons');
printMap(s.disconnectReasons);

section(`404 responses  (${s.count404} total)`);
if (s.count404 > 0) {
	console.log('  Paths:');
	printMap(s.paths404);
	console.log('  IPs generating 404s:');
	printMap(s.ips404);
} else {
	console.log('    (none)');
}

section(`/api/beacon requests  (${s.beaconCount} total)`);
if (s.beaconCount > 0) {
	console.log('  Reason codes:');
	printMap(s.beaconReasons);
} else {
	console.log('    (none)');
}

console.log();
