// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';
import { UAParser } from '@ua-parser-js/pro-personal';
import { dev } from '$app/environment';
import { execSync } from 'node:child_process';
import { incrementVisitors } from '$lib/server/runtimeState';
/**
 * Start of the main server process
 */
import { getLogger } from '$lib/logger';
const logger = getLogger('http');

import version from '../package.json';
let gitCommit = '';
if (dev) {
	try {
		gitCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
	} catch (error) {
		console.warn('Unable to determine git commit hash', error);
	}
}

logger.info(`=============`);
logger.info(`Starting Cutie server: Version: ${version.version}; Git commit: #${gitCommit}`);
logger.info(`    node version: ${process.version}; LOG_LEVEL: ${logger.settings.minLevel}`);

logger.info(`=============`);

// handlers for all kinds of error coditions
process.on('exit', (code) => {
	logger.fatal(`Exiting with code: ${code}`);
	process.exit(code);
});
process.on('SIGINT', () => {
	logger.fatal(`Received SIGINT`);
	process.exit(1);
});
process.on('SIGTERM', () => {
	logger.fatal(`Received SIGTERM`);
});
process.on('uncaughtException', (err, origin) => {
	logger.fatal(`Caught exception: ${err}\nException origin: ${origin}`);
	// It is crucial to handle uncaught exceptions and potentially exit the process gracefully.
});
process.on('unhandledRejection', (reason, promise) => {
	logger.fatal(`caught an unhandled Rejection: ${reason}, ${promise}`);
});
process.on('warning', (warning) => {
	logger.warn(`Process warning: ${warning.message}`);
});

export const handle: Handle = async ({ event, resolve }) => {
	const clientAddress = event.getClientAddress();
	const method = event.request.method;
	const path = event.url.pathname;
	let agent = event.request.headers.get('user-agent');
	if (!agent) agent = '';
	const { browser } = UAParser(agent);

	if (path === '/') {
		incrementVisitors();
		logger.info(`=== New connection ===`);
	}
	logger.info(`  Received http ${method} from ${clientAddress} for ${path} (${browser})`);

	const response = await resolve(event);

	const status = response.status;
	logger.debug(`Completed http ${method} from ${clientAddress} for ${path} status ${status}`);

	return response;
};
