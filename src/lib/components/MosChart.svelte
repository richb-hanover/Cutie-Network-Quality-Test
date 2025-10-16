<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Chart, registerables } from 'chart.js';
	import { tenSecondMosHistory, type MosPoint } from '$lib/stores/mosStore';

	Chart.register(...registerables);

	const MIN_POINTS_FOR_FULL_WIDTH = 120;

	const formatLabel = (timestamp: number): string => {
		const date = new Date(timestamp);
		const hours = date.getHours().toString().padStart(2, '0');
		const minutes = date.getMinutes().toString().padStart(2, '0');
		return `${hours}:${minutes}`;
	};

	const qualityLabels: Record<number, string> = {
		5: 'Excellent',
		4: 'Good',
		3: 'Fair',
		2: 'Poor',
		1: 'Bad'
	};

	let canvas: HTMLCanvasElement | null = null;
	let chart: Chart<'line'> | null = null;
	let unsubscribe: (() => void) | null = null;
	let currentPoints: MosPoint[] = [];

	const computeXCoordinate = (index: number, total: number): number => {
		if (total <= 1) return 0;
		const denominator = Math.max(total - 1, MIN_POINTS_FOR_FULL_WIDTH - 1);
		return index / denominator;
	};

	const updateChart = (points: MosPoint[]) => {
		if (!chart) return;

		currentPoints = points;
		const labels = points.map((point) => formatLabel(point.at));
		const data = points.map((point, index) => ({
			x: computeXCoordinate(index, points.length),
			y: point.value
		}));

		chart.data.labels = labels;
		chart.data.datasets[0].data = data;
		chart.options.scales!.x!.max =
			points.length > 1 ? computeXCoordinate(points.length - 1, points.length) : 1;
		chart.update('none');
	};

	onMount(() => {
		if (!canvas) {
			return;
		}

		chart = new Chart(canvas, {
			type: 'line',
			data: {
				labels: [],
				datasets: [
					{
						label: '10-second MOS',
						data: [],
						borderColor: '#ff6384',
						backgroundColor: '#ff6384',
						pointBackgroundColor: '#ff6384',
						pointBorderColor: '#ff6384',
						pointRadius: 3,
						pointHoverRadius: 4,
						borderWidth: 2,
						fill: false,
						tension: 0.3
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				animation: false,
				interaction: {
					mode: 'index',
					intersect: false
				},
				plugins: {
					legend: {
						display: false
					},
					tooltip: {
						enabled: true,
						displayColors: false,
						callbacks: {
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
							display: false
						},
						min: 0,
						max: 1,
						ticks: {
							autoSkip: false,
							color: '#6b7280',
							maxRotation: 0,
							minRotation: 0,
							callback(value) {
								const numericValue =
									typeof value === 'string' ? Number(value) : (value as number);
								if (!currentPoints.length || Number.isNaN(numericValue)) {
									return '';
								}

								const denominator = Math.max(
									currentPoints.length - 1,
									MIN_POINTS_FOR_FULL_WIDTH - 1
								);
								const approxIndex = Math.round(numericValue * denominator);
								const boundedIndex = Math.min(
									currentPoints.length - 1,
									Math.max(0, approxIndex)
								);
								if (boundedIndex < 0 || boundedIndex >= currentPoints.length) {
									return '';
								}

								if (boundedIndex % 6 !== 0 && boundedIndex !== currentPoints.length - 1) {
									return '';
								}

								return formatLabel(currentPoints[boundedIndex].at);
							}
						}
					},
					y: {
						min: 1,
						max: 5,
						grid: {
							color: '#d1d5db'
						},
						ticks: {
							stepSize: 1,
							color: '#6b7280',
							callback(value) {
								const numeric = Number(value);
								return qualityLabels[numeric] ?? '';
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

		unsubscribe = tenSecondMosHistory.subscribe((points) => {
			updateChart(points);
		});
	});

	onDestroy(() => {
		unsubscribe?.();
		if (chart) {
			chart.destroy();
			chart = null;
		}
	});
</script>

<section class="panel mos-chart">
	<h2>Network Quality Prediction</h2>
	<div class="chart-container">
		<canvas bind:this={canvas} />
	</div>
</section>

<style>
	.mos-chart {
		width: 100%;
	}

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
