import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, createSegment } from "@lifemonitor/core";
import {
  clampMinutes,
  formatDateLabel,
  formatMiniDuration,
  isIsoOnLocalDate,
  maybeFromLocalInputValue,
  midpointIso,
  normalizeTimelineDraft,
  percentage,
  segmentOvertimeSeconds,
  timeInputValueFromMinute,
  toDateInputValue,
  toLocalInputValue,
} from "./time";

describe("desktop time utilities", () => {
  it("formats dates and compact durations for UI controls", () => {
    expect(toDateInputValue(new Date(2026, 4, 21, 13, 5))).toBe("2026-05-21");
    expect(formatDateLabel("2026-05-21", true)).toContain("今天");
    expect(formatMiniDuration(65)).toBe("1:05");
    expect(formatMiniDuration(3660)).toBe("1:01");
    expect(timeInputValueFromMinute(75)).toBe("01:15");
  });

  it("normalizes editable timeline date values", () => {
    const isoDate = "2026-05-21T01:30:00.000Z";
    const localInput = toLocalInputValue(isoDate);

    expect(maybeFromLocalInputValue(localInput)).toBe(isoDate);
    expect(isIsoOnLocalDate(new Date(2026, 4, 21, 9, 30).toISOString(), "2026-05-21")).toBe(true);
  });

  it("calculates segment display times without mutating records", () => {
    const segment = {
      ...createSegment({
        state: "busy",
        taskName: "写代码",
        nowIso: "2026-05-21T01:00:00.000Z",
        settings: { ...DEFAULT_SETTINGS, busyMinutes: 25 },
      }),
      endedAt: "2026-05-21T01:35:00.000Z",
    };

    expect(midpointIso(segment)).toBe("2026-05-21T01:17:30.000Z");
    expect(segmentOvertimeSeconds(segment)).toBe(600);
    expect(normalizeTimelineDraft(segment)).toMatchObject({
      id: segment.id,
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
    });
  });

  it("clamps numeric UI values", () => {
    expect(clampMinutes(Number.NaN, 1, 240)).toBe(1);
    expect(clampMinutes(241, 1, 240)).toBe(240);
    expect(percentage(25, 100)).toBe(25);
    expect(percentage(25, 0)).toBe(0);
  });
});
