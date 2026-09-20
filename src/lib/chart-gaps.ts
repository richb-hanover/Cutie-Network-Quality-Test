// A chart point normally arrives every 10 s. When the page was hidden or frozen the next
// point can be many minutes later, and the chart must show that as a gap, not join the two
// points with a line that looks like measured data (a flat "Excellent" line, or a loss ramp).

/** More than three missed points (30 s) in a row is a gap. */
export const CHART_GAP_SECONDS = 30;

/**
 * gapAwareSegment - Chart.js `segment` option for a line dataset: the line between two
 * points that are more than CHART_GAP_SECONDS apart is drawn transparent. The points stay
 * visible. x values are seconds, as on the chart's x axis.
 */
export const gapAwareSegment = {
	borderColor: (ctx: {
		p0: { parsed: { x: number | null } };
		p1: { parsed: { x: number | null } };
	}) => {
		const { x: x0 } = ctx.p0.parsed;
		const { x: x1 } = ctx.p1.parsed;
		if (x0 === null || x1 === null) {
			return undefined; // no position to compare; keep the default line
		}
		return x1 - x0 > CHART_GAP_SECONDS ? 'transparent' : undefined;
	}
};
