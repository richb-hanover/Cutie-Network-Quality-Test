import { describe, it, expect } from 'vitest';
import { describeSignalingError } from '../src/lib/rtc-client';

const APACHE_503 = `<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN">
<html><head>
<title>503 Service Unavailable</title>
</head><body>
<h1>Service Unavailable</h1>
<p>The server is temporarily unable to service your
request due to maintenance downtime or capacity
problems. Please try again later.</p>
</body></html>
`;

describe('describeSignalingError', () => {
	it('never shows an HTML error page', () => {
		const message = describeSignalingError(503, APACHE_503, 'text/html; charset=iso-8859-1');
		expect(message).not.toContain('<');
		expect(message).toBe('The Cutie server is unavailable right now (503). Try again later.');
	});

	it('spots HTML even without a content type', () => {
		const message = describeSignalingError(502, APACHE_503, null);
		expect(message).toBe('The Cutie server is unavailable right now (502). Try again later.');
	});

	it("uses the server's own JSON message", () => {
		const body = JSON.stringify({ message: 'Expected JSON body with valid WebRTC offer' });
		expect(describeSignalingError(400, body, 'application/json')).toBe(
			'Cutie server error (400): Expected JSON body with valid WebRTC offer'
		);
	});

	it('keeps a short plain-text body', () => {
		expect(describeSignalingError(500, 'boom', 'text/plain')).toBe(
			'Cutie server error (500): boom'
		);
	});

	it('handles an empty or overlong body', () => {
		expect(describeSignalingError(500, '', null)).toBe('Cutie server error (500)');
		expect(describeSignalingError(500, 'x'.repeat(1000), 'text/plain')).toBe(
			'Cutie server error (500)'
		);
	});
});
