/**
 * Types for the Amplitude Dashboard REST API (v2) segmentation endpoint.
 *
 * @see https://amplitude.com/docs/apis/analytics/dashboard-rest
 */

// The canonical per-day count type lives in @/lib/marketing-daily as
// EventDailyCounts (source-neutral). This service returns that type directly, so
// the join doesn't care the data came from Amplitude's API vs anywhere else.

/** Raw shape returned by `GET /api/2/events/segmentation`. */
export interface AmplitudeSegmentationResponse {
  data: {
    /** One array of counts per series (group-by value), aligned to `xValues`. */
    series: number[][];
    /**
     * Labels for each series. For a grouped query Amplitude returns
     * `[[0, "facebook"], [0, "(none)"]]` — index 0 is the event index,
     * index 1 is the group-by value.
     */
    seriesLabels?: Array<[number, string]>;
    /** Dates in `YYYY-MM-DD`, aligned to each series array. */
    xValues: string[];
  };
}

export class AmplitudeApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'AmplitudeApiError';
  }
}
