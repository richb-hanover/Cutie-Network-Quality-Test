<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import {
		Chart,
		registerables,
		type ChartDataset,
		type ChartOptions,
		type ScriptableScaleContext,
		type TooltipItem
	} from 'chart.js';
	import {
		tenSecondMosHistory,
		tenSecondPacketLossHistory,
		tenSecondSummaryHistory,
		type MosPoint,
		type TenSecondSummary
	} from '$lib/stores/mosStore';
	import { buildTimeTooltipTitle, ensureVerticalAlignTooltipPositioner } from '$lib/chartTooltip';
	import type { Readable } from 'svelte/store';

	Chart.register(...registerables);

	const STEP_SECONDS = 60;
	const INITIAL_RANGE_SECONDS = STEP_SECONDS * 10; // 10 minutes
	const MAX_X_AXIS_LABELS = 12;
	const TEST_INTERVAL_MS = 50;
	const TEST_POINT_GAP_MS = 10_000;

	type TimedSample = { at: number };

	type DatasetSpec<TSample extends TimedSample> = {
		label: string;
		color: string | ((ctx: { testMode: boolean }) => string);
		value: (sample: TSample) => number | null;
		spanGaps?: boolean;
		formatTooltipLabel?: (value: number | null) => string;
	};

	type VariantConfig<TSample extends TimedSample> = {
		datasets: DatasetSpec<TSample>[];
		store: Readable<TSample[]>;
		yAxis: NonNullable<NonNullable<ChartOptions<'line'>['scales']>['y']>;
		displayColors: boolean;
		supportsTestMode?: boolean;
		testGenerator?: (emit: (samples: TSample[]) => void) => () => void;
	};

	type ChartVariant = 'mos' | 'packetLoss' | 'latencyJitter';

	const LEFT_AXIS_PADDING: Record<ChartVariant, number> = {
		mos: 0,
		packetLoss: 29,
		latencyJitter: 22
	};

	type MosConfig = VariantConfig<MosPoint>;
	type SummaryConfig = VariantConfig<TenSecondSummary>;
	type AnyVariantConfig = MosConfig | SummaryConfig;
	type VariantConfigMap = {
		mos: MosConfig;
		packetLoss: MosConfig;
		latencyJitter: SummaryConfig;
	};

	export let variant: ChartVariant;
	export let testMode = false;

	let canvas: HTMLCanvasElement | null = null;
	let chart: Chart<'line'> | null = null;
	let unsubscribe: (() => void) | null = null;
	let stopTestMode: (() => void) | null = null;

	let baseTimestamp = alignToStep(Date.now());
	let chartStartTimestamp: number | null = null;
	let xLabelModulo = 1;
	let activeVariant: ChartVariant | null = null;
	let lastTestMode = testMode;

	let currentConfig: AnyVariantConfig = getVariantConfig(variant);
	let datasetSpecs: DatasetSpec<TimedSample>[] =
		currentConfig.datasets as unknown as DatasetSpec<TimedSample>[];

	const formatLabel = (timestamp: number): string => {
		const date = new Date(timestamp);
		const hours = date.getHours().toString().padStart(2, '0');
		const minutes = date.getMinutes().toString().padStart(2, '0');
		return `${hours}:${minutes}`;
	};

	const formatTooltipTitle = (items: TooltipItem<'line'>[]): string =>
		buildTimeTooltipTitle(formatLabel, () => baseTimestamp, items);

	const yAxisLabels: Record<string, string> = {
		'1': 'Bad',
		'2': 'Poor',
		'3': 'Acceptable',
		'4': 'Good',
		'4.5': 'Excellent'
	};

	function alignToStep(timestamp: number): number {
		return Math.floor(timestamp / (STEP_SECONDS * 1000)) * (STEP_SECONDS * 1000);
	}

	function getVariantConfig(instance: ChartVariant): AnyVariantConfig {
		const configs: VariantConfigMap = {
			mos: {
				datasets: [
					{
						label: 'Network Quality (MOS)',
						color: ({ testMode: isTestMode }) => (isTestMode ? 'hotpink' : '#ff6384'),
						value: (point: MosPoint) => point.value,
						formatTooltipLabel: (value) =>
							value === null || Number.isNaN(value) ? 'MOS: —' : `MOS: ${Number(value).toFixed(2)}`
					}
				],
				store: tenSecondMosHistory,
				displayColors: false,
				yAxis: {
					min: 1,
					max: 4.5,
					grid: {
						color: '#d1d5db'
					},
					ticks: {
						stepSize: 0.5,
						color: '#6b7280',
						font: {
							weight: 'bold'
						},
						callback(value) {
							const key = typeof value === 'number' ? value.toString() : String(value);
							return yAxisLabels[key] ?? '';
						}
					}
				},
				supportsTestMode: true,
				testGenerator: createMosTestGenerator
			},
			packetLoss: {
				datasets: [
					{
						label: 'Packet Loss (%)',
						color: '#8c4d15',
						value: (point: MosPoint) => point.value,
						formatTooltipLabel: (value) =>
							value === null || Number.isNaN(value)
								? 'Packet Loss: —'
								: `Packet Loss: ${Number(value).toFixed(2)} %`
					}
				],
				store: tenSecondPacketLossHistory,
				displayColors: false,
				yAxis: {
					min: 0,
					max: 20,
					grace: '10%',
					grid: {
						color: '#d1d5db'
					},
					title: {
						display: true,
						text: 'Packet loss',
						color: '#6b7280',
						padding: { top: 0, bottom: 8 },
						font: {
							weight: 'bold'
						}
					},
					ticks: {
						stepSize: 2,
						color: '#6b7280',
						font: {
							weight: 'bold'
						},
						callback(value) {
							const numeric = Number(value);
							return Number.isNaN(numeric) ? '' : `${numeric}`;
						}
					}
				}
			},
			latencyJitter: {
				datasets: [
					{
						label: 'Average Delay (ms)  ',
						color: '#5959e6',
						value: (summary: TenSecondSummary) => summary.averageLatencyMs ?? null,
						spanGaps: true,
						formatTooltipLabel: (value) =>
							value === null || Number.isNaN(value)
								? 'Average Delay (ms): —'
								: `Average Delay (ms): ${Number(value).toFixed(2)} ms`
					},
					{
						label: 'Average Jitter (ms)',
						color: '#2babab',
						value: (summary: TenSecondSummary) => summary.averageJitterMs ?? null,
						spanGaps: true,
						formatTooltipLabel: (value) =>
							value === null || Number.isNaN(value)
								? 'Average Jitter (ms): —'
								: `Average Jitter (ms): ${Number(value).toFixed(2)} ms`
					}
				],
				store: tenSecondSummaryHistory,
				displayColors: true,
				yAxis: {
					min: 0,
					max: 200,
					grace: '10%',
					grid: {
						color: '#d1d5db'
					},
					title: {
						display: true,
						text: 'ms',
						color: '#6b7280',
						padding: { top: 0, bottom: 8 },
						font: {
							weight: 'bold'
						}
					},
					ticks: {
						stepSize: 20,
						color: '#6b7280',
						font: {
							weight: 'bold'
						},
						callback(value) {
							const numeric = Number(value);
							return Number.isNaN(numeric) ? '' : `${numeric}`;
						}
					}
				}
			}
		};

		return configs[instance];
	}

	function createMosTestGenerator(emit: (samples: MosPoint[]) => void): () => void {
		const points: MosPoint[] = [];
		const startAt = Date.now();
		let virtualAt = startAt;
		const interval = setInterval(() => {
			virtualAt += TEST_POINT_GAP_MS;
			const elapsedSeconds = (virtualAt - startAt) / 1000;
			const sineValue = Math.sin(0.01 * elapsedSeconds);
			const value = 3 + 1.5 * sineValue;
			points.push({ at: virtualAt, value });
			if (points.length > 1000) {
				points.shift();
			}
			emit([...points]);
		}, TEST_INTERVAL_MS);

		return () => {
			clearInterval(interval);
		};
	}

	function applyXAxisSettings(maxSeconds: number) {
		const xScale = chart?.options.scales?.x as
			| (NonNullable<ChartOptions<'line'>['scales']>['x'] & { ticks?: Record<string, unknown> })
			| undefined;
		if (!xScale) {
			return;
		}

		xScale.max = maxSeconds;
		const tickCount = Math.max(1, Math.ceil(maxSeconds / STEP_SECONDS));
		xLabelModulo = Math.max(1, Math.ceil(tickCount / MAX_X_AXIS_LABELS));
		const ticks = (xScale.ticks ??= {});
		ticks.stepSize = STEP_SECONDS;
		ticks.maxRotation = 45;
		ticks.minRotation = 45;
		(ticks as Record<string, unknown>).autoSkip = false;

		const grid = (xScale.grid ??= {});
		grid.color = (ctx: ScriptableScaleContext) =>
			ctx.index % xLabelModulo === 0 ? '#d1d5db' : 'rgba(0,0,0,0)';
		grid.lineWidth = (ctx: ScriptableScaleContext) => (ctx.index % xLabelModulo === 0 ? 1 : 0);
	}

	function resetChartData() {
		if (!chart) {
			return;
		}
		chart.data.datasets.forEach((dataset) => {
			dataset.data = [];
		});
		chartStartTimestamp = null;
		baseTimestamp = alignToStep(Date.now());
		applyXAxisSettings(INITIAL_RANGE_SECONDS);
		chart.update('none');
	}

	function updateDatasetColors() {
		if (!chart) return;
		chart.data.datasets.forEach((dataset, index) => {
			const spec = datasetSpecs[index];
			const resolved = typeof spec.color === 'function' ? spec.color({ testMode }) : spec.color;
			dataset.borderColor = resolved;
			dataset.backgroundColor = resolved;
			dataset.pointBackgroundColor = resolved;
			dataset.pointBorderColor = resolved;
		});
		chart.update('none');
	}

	function getYAxisMax(): number | null {
		const max = currentConfig.yAxis?.max;
		if (typeof max === 'number' && Number.isFinite(max)) {
			return max;
		}
		if (typeof max === 'string') {
			const parsed = Number(max);
			return Number.isFinite(parsed) ? parsed : null;
		}
		return null;
	}

	function updateChart(samples: TimedSample[]) {
		if (!chart) return;

		if (samples.length === 0) {
			resetChartData();
			return;
		}

		const firstSample = samples[0];
		const alignedStart = alignToStep(firstSample.at);

		if (chartStartTimestamp === null || chartStartTimestamp !== alignedStart) {
			chartStartTimestamp = alignedStart;
			baseTimestamp = chartStartTimestamp;
		}

		const yAxisMax = getYAxisMax();

		chart.data.datasets.forEach((dataset, index) => {
			const spec = datasetSpecs[index];
			dataset.data = samples.map((sample) => {
				const rawValue = spec.value(sample);
				if (rawValue === null || Number.isNaN(rawValue)) {
					return {
						x: Math.max(0, (sample.at - baseTimestamp) / 1000),
						y: null
					};
				}

				const clamped = yAxisMax !== null && rawValue > yAxisMax ? yAxisMax : rawValue;

				return {
					x: Math.max(0, (sample.at - baseTimestamp) / 1000),
					y: clamped,
					actual: rawValue
				};
			});
		});

		const lastSample = samples[samples.length - 1];
		const lastDeltaSeconds = Math.max(0, (lastSample.at - baseTimestamp) / 1000);
		const minutesCovered = Math.max(10, Math.ceil(lastDeltaSeconds / STEP_SECONDS) + 1);
		const maxRangeSeconds = minutesCovered * STEP_SECONDS;
		applyXAxisSettings(maxRangeSeconds);
		chart.update('none');
	}

	function stopDataSources() {
		unsubscribe?.();
		unsubscribe = null;
		stopTestMode?.();
		stopTestMode = null;
	}

	function startDataSources() {
		if (!chart) return;
		stopDataSources();
		resetChartData();

		if (currentConfig.supportsTestMode && currentConfig.testGenerator && testMode) {
			stopTestMode = currentConfig.testGenerator((samples) =>
				updateChart(samples as TimedSample[])
			);
			return;
		}

		unsubscribe = currentConfig.store.subscribe((samples) => {
			updateChart(samples as TimedSample[]);
		});
	}

	function buildDatasets(): ChartDataset<'line'>[] {
		return datasetSpecs.map((spec) => {
			const resolved = typeof spec.color === 'function' ? spec.color({ testMode }) : spec.color;
			return {
				label: spec.label,
				data: [],
				borderColor: resolved,
				backgroundColor: resolved,
				pointBackgroundColor: resolved,
				pointBorderColor: resolved,
				pointRadius: 3,
				pointHoverRadius: 4,
				borderWidth: 2,
				fill: false,
				tension: 0.3,
				clip: false,
				spanGaps: spec.spanGaps ?? false
			};
		});
	}

	function tooltipLabelFormatter(context: TooltipItem<'line'>): string {
		const spec = datasetSpecs[context.datasetIndex];
		const raw = context.raw as { actual?: number | null } | number | null;
		const actualValue =
			typeof raw === 'object' && raw !== null && 'actual' in raw
				? (raw.actual ?? null)
				: (context.parsed.y ?? null);
		if (spec?.formatTooltipLabel) {
			return spec.formatTooltipLabel(
				actualValue === null || Number.isNaN(Number(actualValue)) ? null : Number(actualValue)
			);
		}
		return `${spec?.label ?? 'Value'}: ${
			actualValue === null || Number.isNaN(Number(actualValue))
				? '—'
				: Number(actualValue).toFixed(2)
		}`;
	}

	function createChart() {
		if (!canvas) return;

		currentConfig = getVariantConfig(variant);
		datasetSpecs = currentConfig.datasets as unknown as DatasetSpec<TimedSample>[];
		const leftPadding = LEFT_AXIS_PADDING[variant];

		chart = new Chart<'line'>(canvas, {
			type: 'line',
			data: {
				labels: [],
				datasets: buildDatasets()
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				layout: {
					padding: {
						left: leftPadding,
						top: 0,
						bottom: 0
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
							padding: 0,
							font: {
								size: 14,
								weight: 'bold'
							}
						}
					},
					tooltip: {
						enabled: true,
						displayColors: currentConfig.displayColors,
						position: 'verticalAlign',
						callbacks: {
							title: formatTooltipTitle,
							label: tooltipLabelFormatter
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
							padding: 0,
							font: {
								weight: 'bold'
							},
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
					y: currentConfig.yAxis
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
		startDataSources();
		activeVariant = variant;
		lastTestMode = testMode;
	}

	function rebuildChartIfNeeded(currentVariant: ChartVariant) {
		if (!chart) return;
		if (currentVariant === activeVariant) {
			return;
		}

		stopDataSources();
		chart.destroy();
		chart = null;
		createChart();
	}

	function handleTestModeChange(currentTestMode: boolean) {
		if (!chart || !currentConfig.supportsTestMode) {
			return;
		}
		if (currentTestMode === lastTestMode) {
			return;
		}
		updateDatasetColors();
		startDataSources();
		lastTestMode = currentTestMode;
	}

	onMount(() => {
		ensureVerticalAlignTooltipPositioner();
		createChart();
	});

	onDestroy(() => {
		stopDataSources();
		chart?.destroy();
		chart = null;
	});

	$: if (chart) {
		rebuildChartIfNeeded(variant);
	}
	$: if (chart) {
		handleTestModeChange(testMode);
	}
</script>

<div class="chart-card">
	<div class="chart-container">
		<canvas bind:this={canvas}></canvas>
	</div>
</div>

<style>
	.chart-container {
		position: relative;
		width: 100%;
		height: 200px;
	}

	canvas {
		width: 100%;
		height: 100%;
	}
</style>
