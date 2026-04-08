import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { getLogger, ipTag } from '../../../lib/logger';
const logger = getLogger('server-beacon');

/**
 * POST() - a POST handler for /api/beacon
 * Simply log the event that the client sent for opening/closing,
 * showing/hiding/etc the main window
 *
 * @param param0
 * @returns
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const tag = ipTag(getClientAddress());
	let payload;
	try {
		payload = await request.json();
		const summary = {
			connectionId: payload.connectionId,
			reason: payload.reason,
			state: payload.visibilityState
		};
		logger.info(`${tag}${JSON.stringify(summary)}`);
	} catch {
		logger.info(`Expected JSON body with valid WebRTC offer: ${JSON.stringify(payload)}`);
		throw error(400, 'Expected JSON body with valid WebRTC offer');
	}
	return json({ closed: true });
};
