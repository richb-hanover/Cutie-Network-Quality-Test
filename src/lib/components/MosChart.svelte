<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Chart, registerables, type ScriptableScaleContext, type TooltipItem } from 'chart.js';
	import { tenSecondMosHistory, type MosPoint } from '$lib/stores/mosStore';
	import { buildTimeTooltipTitle, ensureVerticalAlignTooltipPositioner } from '$lib/chartTooltip';

	Chart.register(...registerables);

	const STEP_SECONDS = 60;
	const INITIAL_RANGE_SECONDS = STEP_SECONDS * 10; // 10 minutes
	const MAX_X_AXIS_LABELS = 12;
	const TEST_INTERVAL_MS = 50;
	const TEST_POINT_GAP_MS = 10_000;

	const formatLabel = (timestamp: number): string => {
		const date = new Date(timestamp);
		const hours = date.getHours().toString().padStart(2, '0');
		const minutes = date.getMinutes().toString().padStart(2, '0');
		return `${hours}:${minutes}`;
	};

	const yAxisLabels: Record<string, string> = {
		'1': 'Bad',
		'2': 'Poor',
		'3': 'Acceptable',
		'4': 'Good',
		'4.5': 'Excellent'
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

	export let testMode = false;

	let canvas: HTMLCanvasElement | null = null;
	let chart: Chart<'line'> | null = null;
	let unsubscribe: (() => void) | null = null;
	let testInterval: ReturnType<typeof setInterval> | null = null;
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

	const updateDatasetStyles = () => {
		if (!chart) return;
		const dataset = chart.data.datasets[0];
		const color = testMode ? 'hotpink' : '#ff6384';
		dataset.borderColor = color;
		dataset.backgroundColor = color;
		dataset.pointBackgroundColor = color;
		dataset.pointBorderColor = color;
	};

	const updateChart = (points: MosPoint[]) => {
		if (!chart) return;

		if (points.length === 0) {
			chartStartTimestamp = null;
			baseTimestamp = Math.floor(Date.now() / (STEP_SECONDS * 1000)) * (STEP_SECONDS * 1000);
			chart.data.datasets[0].data = [];
			applyXAxisSettings(INITIAL_RANGE_SECONDS);
			chart.update('none');
			return;
		}

		const firstPoint = points[0];
		if (chartStartTimestamp === null) {
			chartStartTimestamp =
				Math.floor(firstPoint.at / (STEP_SECONDS * 1000)) * (STEP_SECONDS * 1000);
			baseTimestamp = chartStartTimestamp;
		} else {
			const candidateStart =
				Math.floor(firstPoint.at / (STEP_SECONDS * 1000)) * (STEP_SECONDS * 1000);
			if (candidateStart !== chartStartTimestamp) {
				chartStartTimestamp = candidateStart;
				baseTimestamp = chartStartTimestamp;
			}
		}

		const data = points.map((point) => ({
			x: Math.max(0, (point.at - baseTimestamp) / 1000),
			y: point.value
		}));

		chart.data.datasets[0].data = data;

		const lastDeltaSeconds = data[data.length - 1]?.x ?? 0;
		const minutesCovered = Math.max(10, Math.ceil(lastDeltaSeconds / STEP_SECONDS) + 1);
		const maxRangeSeconds = minutesCovered * STEP_SECONDS;
		applyXAxisSettings(maxRangeSeconds);
		chart.update('none');
	};

	const startStoreSubscription = () => {
		unsubscribe = tenSecondMosHistory.subscribe((points) => {
			updateChart(points);
		});
	};

	const startTestMode = () => {
		const points: MosPoint[] = [];
		const startAt = Date.now();
		let virtualAt = startAt;
		testInterval = setInterval(() => {
			virtualAt += TEST_POINT_GAP_MS;
			const elapsedSeconds = (virtualAt - startAt) / 1000;
			const sineValue = Math.sin(0.01 * elapsedSeconds);
			const value = 3 + 1.5 * sineValue;
			points.push({ at: virtualAt, value });
			if (points.length > 1000) {
				points.shift();
			}
			updateChart([...points]);
		}, TEST_INTERVAL_MS);
	};

	const stopDataSources = () => {
		unsubscribe?.();
		unsubscribe = null;
		if (testInterval) {
			clearInterval(testInterval);
			testInterval = null;
		}
	};

	const refreshDataSource = () => {
		if (!chart) return;
		stopDataSources();
		updateDatasetStyles();
		chart.data.datasets[0].data = [];
		chartStartTimestamp = null;
		baseTimestamp = Math.floor(Date.now() / (STEP_SECONDS * 1000)) * (STEP_SECONDS * 1000);
		applyXAxisSettings(INITIAL_RANGE_SECONDS);
		chart.update('none');
		if (testMode) {
			startTestMode();
		} else {
			startStoreSubscription();
		}
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
						label: 'Network Quality (MOS)',
						data: [],
						borderColor: '#ff6384',
						backgroundColor: '#ff6384',
						pointBackgroundColor: '#ff6384',
						pointBorderColor: '#ff6384',
						pointRadius: 3,
						pointHoverRadius: 4,
						borderWidth: 2,
						fill: false,
						tension: 0.3,
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
						displayColors: false,
						position: 'verticalAlign',
						callbacks: {
							title: formatTooltipTitle,
							label(context) {
								const value = context.parsed.y ?? context.raw;
								return `MOS: ${Number(value).toFixed(2)}`;
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
						min: 1,
						max: 4.5,
						grid: {
							color: '#d1d5db'
						},
						ticks: {
							stepSize: 0.5,
							color: '#6b7280',
							callback(value) {
								const key = typeof value === 'number' ? value.toString() : String(value);
								return yAxisLabels[key] ?? '';
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

	let lastMode = testMode;
	$: if (chart && testMode !== lastMode) {
		lastMode = testMode;
		refreshDataSource();
	}
</script>

<div class="chart-card mos-chart">
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
