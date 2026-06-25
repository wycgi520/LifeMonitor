import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  calculateTodayStats,
  canMergeSegments,
  createManualSegment,
  createSegment,
  deriveTimerSnapshot,
  extendDueAt,
  mergeSegments,
  splitSegmentAt,
} from "./index";

describe("timer snapshot", () => {
  it("keeps counting overtime when a reminder is not handled", () => {
    const segment = createSegment({
      state: "busy",
      taskName: "写代码",
      nowIso: "2026-05-21T01:00:00.000Z",
      settings: { ...DEFAULT_SETTINGS, busyMinutes: 50 },
    });

    const snapshot = deriveTimerSnapshot({
      state: "busy",
      activeSegment: segment,
      settings: DEFAULT_SETTINGS,
      nowIso: "2026-05-21T02:00:30.000Z",
    });

    expect(snapshot.elapsedSeconds).toBe(3630);
    expect(snapshot.overtimeSeconds).toBe(630);
    expect(snapshot.isDue).toBe(true);
  });

  it("extends from now after the current due time has already passed", () => {
    expect(
      extendDueAt("2026-05-21T01:50:00.000Z", "2026-05-21T01:55:00.000Z", 10),
    ).toBe("2026-05-21T02:05:00.000Z");
  });
});

describe("segment merge", () => {
  it("allows same state and task across different runs and non-adjacent times", () => {
    const left = {
      ...createSegment({
        state: "busy",
        taskName: "coding",
        nowIso: "2026-05-21T01:00:00.000Z",
        settings: DEFAULT_SETTINGS,
        stateRunId: "run_a",
      }),
      endedAt: "2026-05-21T01:30:00.000Z",
      plannedEndAt: "2026-05-21T01:50:00.000Z",
    };
    const right = {
      ...createSegment({
        state: "busy",
        taskName: " coding ",
        nowIso: "2026-05-21T02:00:00.000Z",
        settings: DEFAULT_SETTINGS,
        stateRunId: "run_b",
      }),
      endedAt: "2026-05-21T02:30:00.000Z",
      plannedEndAt: "2026-05-21T02:50:00.000Z",
    };

    expect(canMergeSegments(left, right)).toBe(true);
  });

  it("rejects different states or different tasks", () => {
    const left = {
      ...createSegment({
        state: "busy",
        taskName: "coding",
        nowIso: "2026-05-21T01:00:00.000Z",
        settings: DEFAULT_SETTINGS,
      }),
      endedAt: "2026-05-21T01:30:00.000Z",
    };

    expect(
      canMergeSegments(left, {
        ...left,
        id: "segment_rest",
        state: "rest",
      }),
    ).toBe(false);
    expect(
      canMergeSegments(left, {
        ...left,
        id: "segment_reading",
        taskName: "reading",
      }),
    ).toBe(false);
  });
});

describe("today stats", () => {
  it("clips segments to the local day range and groups task time", () => {
    const segments = [
      {
        ...createSegment({
          state: "busy",
          taskName: "写代码",
          nowIso: "2026-05-21T01:00:00.000Z",
          settings: DEFAULT_SETTINGS,
        }),
        endedAt: "2026-05-21T02:00:00.000Z",
        plannedEndAt: "2026-05-21T01:50:00.000Z",
      },
      {
        ...createSegment({
          state: "rest",
          taskName: "喝水",
          nowIso: "2026-05-21T02:00:00.000Z",
          settings: DEFAULT_SETTINGS,
        }),
        endedAt: "2026-05-21T02:20:00.000Z",
        plannedEndAt: "2026-05-21T02:10:00.000Z",
      },
    ];

    const stats = calculateTodayStats(
      segments,
      "2026-05-21T00:00:00.000Z",
      "2026-05-22T00:00:00.000Z",
      "2026-05-21T03:00:00.000Z",
    );

    expect(stats.busySeconds).toBe(3600);
    expect(stats.restSeconds).toBe(1200);
    expect(stats.overtimeBusySeconds).toBe(600);
    expect(stats.overtimeRestSeconds).toBe(600);
    expect(stats.undertimeBusySeconds).toBe(0);
    expect(stats.undertimeRestSeconds).toBe(0);
    expect(stats.idleSeconds).toBe(2400);
    expect(stats.pomodoroCount).toBe(1);
    expect(stats.taskStats).toEqual([{ taskName: "写代码", seconds: 3600 }]);
  });

  it("does not count a pomodoro until the following rest has ended", () => {
    const busy = {
      ...createSegment({
        state: "busy",
        taskName: "写代码",
        nowIso: "2026-05-21T01:00:00.000Z",
        settings: DEFAULT_SETTINGS,
        stateRunId: "run_busy",
      }),
      endedAt: "2026-05-21T01:50:00.000Z",
    };
    const openRest = createSegment({
      state: "rest",
      taskName: "喝水",
      nowIso: "2026-05-21T01:50:00.000Z",
      settings: DEFAULT_SETTINGS,
      stateRunId: "run_rest",
    });

    const stats = calculateTodayStats(
      [busy, openRest],
      "2026-05-21T00:00:00.000Z",
      "2026-05-22T00:00:00.000Z",
      "2026-05-21T02:00:00.000Z",
    );

    expect(stats.pomodoroCount).toBe(0);
  });

  it("counts split or paused runs as one pomodoro combination", () => {
    const busyStart = {
      ...createSegment({
        state: "busy",
        taskName: "写代码",
        nowIso: "2026-05-21T01:00:00.000Z",
        settings: DEFAULT_SETTINGS,
        stateRunId: "run_busy",
      }),
      endedAt: "2026-05-21T01:20:00.000Z",
    };
    const busyResume = {
      ...createSegment({
        state: "busy",
        taskName: "写代码",
        nowIso: "2026-05-21T01:25:00.000Z",
        settings: DEFAULT_SETTINGS,
        stateRunId: "run_busy",
      }),
      endedAt: "2026-05-21T01:50:00.000Z",
    };
    const rest = {
      ...createSegment({
        state: "rest",
        taskName: "喝水",
        nowIso: "2026-05-21T01:50:00.000Z",
        settings: DEFAULT_SETTINGS,
        stateRunId: "run_rest",
      }),
      endedAt: "2026-05-21T02:00:00.000Z",
    };

    const stats = calculateTodayStats(
      [busyStart, busyResume, rest],
      "2026-05-21T00:00:00.000Z",
      "2026-05-22T00:00:00.000Z",
      "2026-05-21T02:30:00.000Z",
    );

    expect(stats.pomodoroCount).toBe(1);
  });

  it("counts idle gaps after the first recorded interval and up to now for today", () => {
    const busy = {
      ...createSegment({
        state: "busy",
        taskName: "写代码",
        nowIso: "2026-05-21T01:00:00.000Z",
        settings: DEFAULT_SETTINGS,
      }),
      endedAt: "2026-05-21T01:30:00.000Z",
    };
    const rest = {
      ...createSegment({
        state: "rest",
        taskName: "喝水",
        nowIso: "2026-05-21T01:40:00.000Z",
        settings: DEFAULT_SETTINGS,
      }),
      endedAt: "2026-05-21T01:50:00.000Z",
    };

    const stats = calculateTodayStats(
      [busy, rest],
      "2026-05-21T00:00:00.000Z",
      "2026-05-22T00:00:00.000Z",
      "2026-05-21T02:10:00.000Z",
    );

    expect(stats.idleSeconds).toBe(1800);
  });

  it("does not count the rest of a historical day as idle", () => {
    const busy = {
      ...createSegment({
        state: "busy",
        taskName: "写代码",
        nowIso: "2026-05-21T01:00:00.000Z",
        settings: DEFAULT_SETTINGS,
      }),
      endedAt: "2026-05-21T01:30:00.000Z",
    };
    const rest = {
      ...createSegment({
        state: "rest",
        taskName: "喝水",
        nowIso: "2026-05-21T01:40:00.000Z",
        settings: DEFAULT_SETTINGS,
      }),
      endedAt: "2026-05-21T01:50:00.000Z",
    };

    const stats = calculateTodayStats(
      [busy, rest],
      "2026-05-21T00:00:00.000Z",
      "2026-05-22T00:00:00.000Z",
      "2026-05-23T02:10:00.000Z",
    );

    expect(stats.idleSeconds).toBe(600);
  });

  it("counts overtime when a timed-out segment is extended to the actual handled time", () => {
    const segment = {
      ...createSegment({
        state: "busy",
        taskName: "写代码",
        nowIso: "2026-05-21T01:00:00.000Z",
        settings: { ...DEFAULT_SETTINGS, busyMinutes: 50 },
      }),
      endedAt: "2026-05-21T02:05:00.000Z",
      plannedEndAt: "2026-05-21T01:50:00.000Z",
    };

    const stats = calculateTodayStats(
      [segment],
      "2026-05-21T00:00:00.000Z",
      "2026-05-22T00:00:00.000Z",
      "2026-05-21T03:00:00.000Z",
    );

    expect(stats.busySeconds).toBe(3900);
    expect(stats.overtimeBusySeconds).toBe(900);
    expect(stats.undertimeBusySeconds).toBe(0);
  });

  it("counts undertime for closed segments that ended before their planned end", () => {
    const segment = {
      ...createSegment({
        state: "rest",
        taskName: "喝水",
        nowIso: "2026-05-21T01:00:00.000Z",
        settings: { ...DEFAULT_SETTINGS, restMinutes: 20 },
      }),
      endedAt: "2026-05-21T01:08:00.000Z",
      plannedEndAt: "2026-05-21T01:20:00.000Z",
    };

    const stats = calculateTodayStats(
      [segment],
      "2026-05-21T00:00:00.000Z",
      "2026-05-22T00:00:00.000Z",
      "2026-05-21T03:00:00.000Z",
    );

    expect(stats.restSeconds).toBe(480);
    expect(stats.overtimeRestSeconds).toBe(0);
    expect(stats.undertimeRestSeconds).toBe(720);
  });

  it("assigns pomodoro counts to the segment start day while clipping durations to the selected day", () => {
    const segment = {
      ...createSegment({
        state: "busy",
        taskName: "跨天",
        nowIso: "2026-05-20T23:40:00.000Z",
        settings: DEFAULT_SETTINGS,
      }),
      endedAt: "2026-05-21T00:20:00.000Z",
      plannedEndAt: "2026-05-21T00:30:00.000Z",
    };

    const stats = calculateTodayStats(
      [segment],
      "2026-05-21T00:00:00.000Z",
      "2026-05-22T00:00:00.000Z",
      "2026-05-21T03:00:00.000Z",
    );

    expect(stats.busySeconds).toBe(1200);
    expect(stats.pomodoroCount).toBe(0);
  });

  it("splits a segment without changing its state run", () => {
    const segment = {
      ...createSegment({
        state: "busy",
        taskName: null,
        note: "原始备注",
        nowIso: "2026-05-21T01:00:00.000Z",
        settings: DEFAULT_SETTINGS,
      }),
      endedAt: "2026-05-21T02:00:00.000Z",
    };

    const [left, right] = splitSegmentAt(segment, "2026-05-21T01:30:00.000Z", "2026-05-21T03:00:00.000Z");

    expect(left.endedAt).toBe("2026-05-21T01:30:00.000Z");
    expect(right.startedAt).toBe("2026-05-21T01:30:00.000Z");
    expect(right.stateRunId).toBe(segment.stateRunId);
    expect(left.note).toBe("原始备注");
    expect(right.note).toBe("原始备注");
  });

  it("merges different notes with a newline and keeps identical notes once", () => {
    const left = {
      ...createSegment({
        state: "busy",
        taskName: "coding",
        note: "左侧备注",
        nowIso: "2026-05-21T01:00:00.000Z",
        settings: DEFAULT_SETTINGS,
      }),
      endedAt: "2026-05-21T01:30:00.000Z",
    };
    const right = {
      ...createSegment({
        state: "busy",
        taskName: "coding",
        note: "右侧备注",
        nowIso: "2026-05-21T01:30:00.000Z",
        settings: DEFAULT_SETTINGS,
      }),
      endedAt: "2026-05-21T02:00:00.000Z",
    };

    expect(mergeSegments(left, right).note).toBe("左侧备注\n右侧备注");
    expect(mergeSegments(left, { ...right, note: "左侧备注" }).note).toBe("左侧备注");
  });

  it("creates closed edited segments for manual backfill", () => {
    const segment = createManualSegment({
      state: "busy",
      taskName: "补记会议",
      note: "会后补记",
      startedAt: "2026-05-21T03:00:00.000Z",
      endedAt: "2026-05-21T03:45:00.000Z",
      settings: { ...DEFAULT_SETTINGS, busyMinutes: 30 },
      nowIso: "2026-05-21T04:00:00.000Z",
    });

    expect(segment.endedAt).toBe("2026-05-21T03:45:00.000Z");
    expect(segment.plannedEndAt).toBe("2026-05-21T03:30:00.000Z");
    expect(segment.note).toBe("会后补记");
    expect(segment.isEdited).toBe(true);
  });
});
