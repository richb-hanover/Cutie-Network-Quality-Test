<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Chart, registerables, type ScriptableScaleContext, type TooltipItem } from 'chart.js';
	import { tenSecondSummaryHistory, type TenSecondSummary } from '$lib/stores/mosStore';
	import { buildTimeTooltipTitle, ensureVerticalAlignTooltipPositioner } from '$lib/chartTooltip';

	Chart.register(...registerables);

	const STEP_SECONDS = 60;
	const INITIAL_RANGE_SECONDS = STEP_SECONDS * 10; // 10 minutes
	const MAX_X_AXIS_LABELS = 12;

	const formatLabel = (timestamp: number): string => {
		const date = new Date(timestamp);
		const hours = date.getHours().toString().padStart(2, '0');
		const minutes = date.getMinutes().toString().padStart(2, '0');
		return `${hours}:${minutes}`;
	};

	type LinearTickOptions = Record<string, unknown> & {
		stepSize?: number;
		maxRotation?: number;
		minRotation?: number;
	};

	type LinearAxisOptions = {
		max?: number;
		min?: number;
		ticks?: LinearTickOptions;
		grid?: {
			color?: (ctx: ScriptableScaleContext) => string;
			lineWidth?: (ctx: ScriptableScaleContext) => number;
		};
	};

	let canvas: HTMLCanvasElement | null = null;
	let chart: Chart<'line'> | null = null;
	let unsubscribe: (() => void) | null = null;
	let baseTimestamp = Math.floor(Date.now() / (STEP_SECONDS * 1000)) * (STEP_SECONDS * 1000);
	let chartStartTimestamp: number | null = null;
	let xLabelModulo = 1;

	const formatTooltipTitle = (items: TooltipItem<'line'>[]): string =>
		buildTimeTooltipTitle(formatLabel, () => baseTimestamp, items);

	const applyXAxisSettings = (maxSeconds: number) => {
		const xScale = chart?.options.scales?.x as LinearAxisOptions | undefined;
		if (!xScale) {
			return;
		}

		xScale.max = maxSeconds;
		const tickCount = Math.max(1, Math.ceil(maxSeconds / STEP_SECONDS));
		xLabelModulo = Math.max(1, Math.ceil(tickCount / MAX_X_AXIS_LABELS));
		const ticks = (xScale.ticks ??= {} as LinearTickOptions);
		ticks.stepSize = STEP_SECONDS;
		ticks.maxRotation = 45;
		ticks.minRotation = 45;

		const grid = (xScale.grid ??= {});
		grid.color = (ctx) => (ctx.index % xLabelModulo === 0 ? '#d1d5db' : 'rgba(0,0,0,0)');
		grid.lineWidth = (ctx) => (ctx.index % xLabelModulo === 0 ? 1 : 0);
	};

	const toDatasetPoints = (
		summaries: TenSecondSummary[],
		key: 'averageLatencyMs' | 'averageJitterMs'
	) =>
		summaries.map((summary) => ({
			x: Math.max(0, (summary.at - baseTimestamp) / 1000),
			y: summary[key] ?? null
		}));

	const updateChart = (summaries: TenSecondSummary[]) => {
		if (!chart) return;

		if (summaries.length === 0) {
			chartStartTimestamp = null;
			baseTimestamp = Math.floor(Date.now() / (STEP_SECONDS * 1000)) * (STEP_SECONDS * 1000);
			chart.data.datasets[0].data = [];
			chart.data.datasets[1].data = [];
			applyXAxisSettings(INITIAL_RANGE_SECONDS);
			chart.update('none');
			return;
		}

		const firstEntry = summaries[0];
		if (chartStartTimestamp === null) {
			chartStartTimestamp =
				Math.floor(firstEntry.at / (STEP_SECONDS * 1000)) * (STEP_SECONDS * 1000);
			baseTimestamp = chartStartTimestamp;
		} else {
			const candidateStart =
				Math.floor(firstEntry.at / (STEP_SECONDS * 1000)) * (STEP_SECONDS * 1000);
			if (candidateStart !== chartStartTimestamp) {
				chartStartTimestamp = candidateStart;
				baseTimestamp = chartStartTimestamp;
			}
		}

		chart.data.datasets[0].data = toDatasetPoints(summaries, 'averageLatencyMs');
		chart.data.datasets[1].data = toDatasetPoints(summaries, 'averageJitterMs');

		const lastEntry = summaries[summaries.length - 1];
		const lastDeltaSeconds = Math.max(0, (lastEntry.at - baseTimestamp) / 1000);
		const minutesCovered = Math.max(10, Math.ceil(lastDeltaSeconds / STEP_SECONDS) + 1);
		const maxRangeSeconds = minutesCovered * STEP_SECONDS;
		applyXAxisSettings(maxRangeSeconds);
		chart.update('none');
	};

	const startStoreSubscription = () => {
		unsubscribe = tenSecondSummaryHistory.subscribe((summaries) => {
			updateChart(summaries);
		});
	};

	const stopDataSources = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	const refreshDataSource = () => {
		if (!chart) return;
		stopDataSources();
		chart.data.datasets[0].data = [];
		chart.data.datasets[1].data = [];
		chartStartTimestamp = null;
		baseTimestamp = Math.floor(Date.now() / (STEP_SECONDS * 1000)) * (STEP_SECONDS * 1000);
		applyXAxisSettings(INITIAL_RANGE_SECONDS);
		chart.update('none');
		startStoreSubscription();
	};

	onMount(() => {
		ensureVerticalAlignTooltipPositioner();

		if (!canvas) {
			return;
		}

		chart = new Chart(canvas, {
			type: 'line',
			data: {
				labels: [],
				datasets: [
					{
						label: 'Average Delay (ms)',
						data: [],
						borderColor: '#5959e6',
						backgroundColor: '#5959e6',
						pointBackgroundColor: '#5959e6',
						pointBorderColor: '#5959e6',
						pointRadius: 3,
						pointHoverRadius: 4,
						borderWidth: 2,
						fill: false,
						tension: 0.3,
						spanGaps: true,
						clip: false
					},
					{
						label: 'Average Jitter (ms)',
						data: [],
						borderColor: '#2babab',
						backgroundColor: '#2babab',
						pointBackgroundColor: '#2babab',
						pointBorderColor: '#2babab',
						pointRadius: 3,
						pointHoverRadius: 4,
						borderWidth: 2,
						fill: false,
						tension: 0.3,
						spanGaps: true,
						clip: false
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				layout: {
					padding: {
						top: 15,
						bottom: 15
					}
				},
				animation: false,
				interaction: {
					mode: 'index',
					intersect: false
				},
				plugins: {
					legend: {
						display: true,
						position: 'top',
						labels: {
							font: {
								size: 14,
								weight: 'bold'
							}
						}
					},
					tooltip: {
						enabled: true,
						displayColors: true,
						position: 'verticalAlign',
						callbacks: {
							title: formatTooltipTitle,
							label(context) {
								const value = context.parsed.y;
								if (value === null || Number.isNaN(value)) {
									return `${context.dataset.label}: —`;
								}
								return `${context.dataset.label}: ${Number(value).toFixed(2)} ms`;
							}
						}
					}
				},
				scales: {
					x: {
						type: 'linear',
						grid: {
							color: '#d1d5db'
						},
						min: 0,
						max: INITIAL_RANGE_SECONDS,
						ticks: {
							color: '#6b7280',
							maxRotation: 45,
							minRotation: 45,
							autoSkip: false,
							stepSize: STEP_SECONDS,
							callback(value, index) {
								if (index % xLabelModulo !== 0) {
									return '';
								}
								const numericValue = typeof value === 'string' ? Number(value) : (value as number);
								if (Number.isNaN(numericValue)) {
									return '';
								}

								const timestamp = baseTimestamp + numericValue * 1000;
								return formatLabel(timestamp);
							}
						}
					},
					y: {
						min: 0,
						max: 200,
						grace: '10%',
						grid: {
							color: '#d1d5db'
						},
						ticks: {
							stepSize: 20,
							color: '#6b7280',
							callback(value) {
								const numeric = Number(value);
								if (Number.isNaN(numeric)) {
									return '';
								}
								return `${numeric}`;
							}
						}
					}
				},
				elements: {
					line: {
						tension: 0.3
					},
					point: {
						radius: 3
					}
				}
			}
		});

		applyXAxisSettings(INITIAL_RANGE_SECONDS);
		refreshDataSource();
	});

	onDestroy(() => {
		stopDataSources();
		if (!chart) return;
		chart.destroy();
		chart = null;
	});
</script>

<div class="chart-card latency-jitter-chart">
	<div class="chart-container">
		<canvas bind:this={canvas}></canvas>
	</div>
</div>

<style>
	.chart-container {
		position: relative;
		width: 100%;
		height: 300px;
	}

	canvas {
		width: 100%;
		height: 100%;
	}
</style>
