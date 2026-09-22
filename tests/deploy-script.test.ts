import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

// deploy.sh normally checks out a branch, reinstalls, builds and starts the preview server.
// Here git, npm and lsof are stubs that only record what they were asked to do, so we can
// see which host and branch the script would use without deploying anything.
const SCRIPT = resolve('deploy.sh');

let workDir: string;
let recordFile: string;

function writeStub(binDir: string, name: string, body: string) {
	const file = join(binDir, name);
	writeFileSync(file, `#!/bin/sh\n${body}\n`);
	chmodSync(file, 0o755);
}

function recordedCommands(): string[] {
	try {
		return readFileSync(recordFile, 'utf8').split('\n').filter(Boolean);
	} catch {
		return [];
	}
}

function sleepMs(ms: number) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Runs deploy.sh with the given arguments; returns everything the stubs recorded. */
function deploy(args: string[]): string[] {
	const result = spawnSync('bash', [SCRIPT, ...args], {
		cwd: workDir,
		env: {
			PATH: `${join(workDir, 'bin')}:/usr/bin:/bin:/usr/sbin:/sbin`,
			HOME: workDir,
			RECORD: recordFile
		},
		encoding: 'utf8'
	});
	expect(result.status, result.stderr).toBe(0);

	// The preview server is started in the background, so give the stub a moment to record it.
	for (let i = 0; i < 60 && !recordedCommands().some((c) => c.startsWith('npm run preview')); i++) {
		sleepMs(50);
	}
	return recordedCommands();
}

describe('deploy.sh host argument', () => {
	beforeEach(() => {
		workDir = mkdtempSync(join(tmpdir(), 'cutie-deploy-'));
		recordFile = join(workDir, 'record.txt');
		const binDir = join(workDir, 'bin');
		mkdirSync(binDir);
		writeStub(binDir, 'git', 'echo "git $*" >> "$RECORD"');
		writeStub(binDir, 'npm', 'echo "npm $*" >> "$RECORD"');
		writeStub(binDir, 'lsof', 'exit 0'); // nothing already listening on the port
	});

	afterEach(() => {
		rmSync(workDir, { recursive: true, force: true });
	});

	it('serves on localhost only when no host is given (production, behind Apache)', () => {
		const commands = deploy([]);

		expect(commands).toContain('git checkout main');
		expect(commands).toContain('npm run preview -- --host localhost --port 4173');
	});

	it('serves on localhost only when only a branch is given', () => {
		const commands = deploy(['handle-lid-sleep']);

		expect(commands).toContain('git checkout handle-lid-sleep');
		expect(commands).toContain('npm run preview -- --host localhost --port 4173');
	});

	it('serves on the host given as the second argument (LAN test box)', () => {
		const commands = deploy(['handle-lid-sleep', '0.0.0.0']);

		expect(commands).toContain('git checkout handle-lid-sleep');
		expect(commands).toContain('npm run preview -- --host 0.0.0.0 --port 4173');
		expect(commands).not.toContain('npm run preview -- --host localhost --port 4173');
	});

	it('skips lifecycle scripts on the initial npm install, since npm ci reruns them cleanly right after', () => {
		// A prior npm install's "prepare" script (svelte-kit sync) intermittently
		// crashed with a Bus error, likely racing an incremental install still
		// rewriting a native binary underneath it. npm ci's own "prepare" run, on a
		// fully clean reinstall, is unaffected, so the first install shouldn't run
		// scripts at all.
		const commands = deploy([]);

		expect(commands).toContain('npm install --ignore-scripts');
		expect(commands).toContain('npm ci');
	});
});
