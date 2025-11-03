// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';
import { UAParser } from '@ua-parser-js/pro-personal';

import { getLogger } from '$lib/logger';
const logger = getLogger('http');

export const handle: Handle = async ({ event, resolve }) => {
	const clientAddress = event.getClientAddress();
	const method = event.request.method;
	const path = event.url.pathname;
	let agent = event.request.headers.get('user-agent');
	if (!agent) agent = '';
	const { browser } = UAParser(agent);

	logger.info(`Received  http ${method} from ${clientAddress} for ${path} (${browser})`);

	const response = await resolve(event);

	const status = response.status;
	logger.debug(`Completed http ${method} from ${clientAddress} for ${path} status ${status}`);

	return response;
};
