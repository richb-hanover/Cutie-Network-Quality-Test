import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { PageData } from './$types';
import Page from './+page.svelte';

vi.mock('chart.js', () => {
	class MockChart {
		canvas;
		ctx;
		options;
		data;

		constructor() {
			this.canvas = document.createElement('canvas');
			this.ctx = null;
			this.options = { scales: { x: {}, y: {} } };
			this.data = { datasets: [] };
		}

		static register() {}
		update() {}
		destroy() {}
		reset() {}
	}

	const Tooltip = { positioners: {} };

	return {
		Chart: MockChart,
		Tooltip,
		registerables: [],
		defaults: {}
	};
});

vi.mock('$lib/rtc-client', () => {
	const mockDataChannel = {
		readyState: 'open' as RTCDataChannelState,
		addEventListener: vi.fn(),
		send: vi.fn()
	};

	const mockPeerConnection = {
		connectionState: 'connected' as RTCPeerConnectionState,
		iceConnectionState: 'connected' as RTCIceConnectionState,
		addEventListener: vi.fn()
	};

	return {
		createServerConnection: vi.fn(async () => ({
			connectionId: 'test-connection',
			peerConnection: mockPeerConnection,
			dataChannel: mockDataChannel,
			close: vi.fn()
		}))
	};
});

vi.mock('$lib/rtc-stats', () => ({
	startStatsReporter: vi.fn(() => () => {})
}));

vi.mock('$app/stores', async () => {
	const { readable } = await vi.importActual<typeof import('svelte/store')>('svelte/store');
	return {
		page: readable({
			url: new URL('https://example.com/'),
			params: {},
			route: { id: null },
			status: 200,
			error: null,
			data: {},
			form: null,
			state: {}
		})
	};
});

describe('/+page.svelte', () => {
	it('should render h1', async () => {
		const testData: PageData = {
			version: 'test',
			gitCommit: 'abc123'
		};

		const { unmount } = render(Page, { props: { data: testData } });

		const heading = await screen.findByRole('heading', { level: 1 });
		expect(heading).toBeInTheDocument();
		await unmount();
	});
});
