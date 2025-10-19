import {
	Tooltip,
	type ChartType,
	type TooltipItem,
	type TooltipPositionerFunction
} from 'chart.js';

const TOOLTIP_TOP_GAP_PX = 56;
let positionerRegistered = false;

export const ensureVerticalAlignTooltipPositioner = () => {
	if (positionerRegistered) {
		return;
	}

	Tooltip.positioners.verticalAlign = function (this, items, _eventPosition) {
		if (!items.length) {
			return false;
		}

		const xValues: number[] = [];
		let yTotal = 0;
		let count = 0;

		for (const item of items) {
			const element = item.element;
			if (!element) {
				continue;
			}

			if (typeof element.hasValue === 'function' && !element.hasValue()) {
				continue;
			}

			const pos = element.tooltipPosition(true);
			if (!pos || pos.x == null || pos.y == null) {
				continue;
			}

			xValues.push(pos.x);
			yTotal += pos.y;
			count += 1;
		}

		if (count === 0 || xValues.length === 0) {
			return false;
		}

		const x = xValues.reduce((sum, value) => sum + value, 0) / xValues.length;
		const y = yTotal / count;
		const { chartArea } = this.chart;
		const rawCaretPadding = this.options.caretPadding;
		const rawCaretSize = this.options.caretSize;
		const caretPadding = typeof rawCaretPadding === 'number' ? rawCaretPadding : 0;
		const caretSize = typeof rawCaretSize === 'number' ? rawCaretSize : 0;
		const caretOffset = caretPadding + caretSize;
		const hasHeadroom = y - chartArea.top > TOOLTIP_TOP_GAP_PX;

		const yAlign = hasHeadroom ? 'bottom' : 'top';

		const chartTop = chartArea.top + caretOffset;
		const chartBottom = chartArea.bottom - caretOffset;
		const targetY = hasHeadroom ? y - caretOffset : y + caretOffset;
		const clampedY = Math.min(Math.max(targetY, chartTop), chartBottom);

		return { x, y: clampedY, xAlign: 'center', yAlign };
	} as TooltipPositionerFunction<ChartType>;

	positionerRegistered = true;
};

export const buildTimeTooltipTitle = (
	formatTimestamp: (timestamp: number) => string,
	getBaseTimestamp: () => number,
	items: TooltipItem<'line'>[]
): string => {
	const first = items[0];
	if (!first) {
		return '';
	}

	const xValue = first.parsed?.x;
	if (typeof xValue !== 'number' || Number.isNaN(xValue)) {
		return '';
	}

	const timestamp = getBaseTimestamp() + xValue * 1000;
	return `Time: ${formatTimestamp(timestamp)}`;
};
