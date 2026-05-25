export type LifeState = "idle" | "busy" | "rest" | "paused";

export type TrackableState = "busy" | "rest";

export type ReminderPolicy = "stop-at-timeout";

export type CloseWindowBehavior = "ask" | "minimize-to-tray" | "quit";

export interface LifeSettings {
  busyMinutes: number;
  restMinutes: number;
  soundEnabled: boolean;
  alwaysOnTop: boolean;
  autostart: boolean;
  closeWindowBehavior: CloseWindowBehavior;
  quickTasks: string[];
  reminderPolicy: ReminderPolicy;
}

export interface TimelineSegment {
  id: string;
  stateRunId: string;
  state: TrackableState;
  taskName: string | null;
  startedAt: string;
  endedAt: string | null;
  plannedEndAt: string;
  createdAt: string;
  updatedAt: string;
  isEdited: boolean;
}

export interface TimerSnapshot {
  state: LifeState;
  taskName: string | null;
  startedAt: string | null;
  dueAt: string | null;
  elapsedSeconds: number;
  remainingSeconds: number;
  overtimeSeconds: number;
  targetMinutes: number;
  extensionMinutes: number;
  isDue: boolean;
}

export interface TaskStat {
  taskName: string;
  seconds: number;
}

export interface TodayStats {
  busySeconds: number;
  restSeconds: number;
  overtimeBusySeconds: number;
  overtimeRestSeconds: number;
  taskStats: TaskStat[];
  unmarkedSeconds: number;
}

export const DEFAULT_SETTINGS: LifeSettings = {
  busyMinutes: 50,
  restMinutes: 10,
  soundEnabled: true,
  alwaysOnTop: true,
  autostart: false,
  closeWindowBehavior: "ask",
  quickTasks: ["写代码", "看文档", "开会", "学习英语", "玩游戏"],
  reminderPolicy: "stop-at-timeout",
};

export const UNMARKED_TASK = "未标记";

export function createId(prefix = "lm"): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && "randomUUID" in cryptoApi) {
    return `${prefix}_${cryptoApi.randomUUID()}`;
  }

  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export function addMinutes(isoDate: string, minutes: number): string {
  return new Date(new Date(isoDate).getTime() + minutes * 60_000).toISOString();
}

export function secondsBetween(startIso: string, endIso: string): number {
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000));
}

export function getTargetMinutes(state: TrackableState, settings: LifeSettings): number {
  return state === "busy" ? settings.busyMinutes : settings.restMinutes;
}

export function createSegment(input: {
  state: TrackableState;
  taskName?: string | null;
  nowIso: string;
  settings: LifeSettings;
  stateRunId?: string;
  plannedEndAt?: string;
}): TimelineSegment {
  const plannedEndAt =
    input.plannedEndAt ?? addMinutes(input.nowIso, getTargetMinutes(input.state, input.settings));

  return {
    id: createId("segment"),
    stateRunId: input.stateRunId ?? createId("run"),
    state: input.state,
    taskName: normalizeTaskName(input.taskName),
    startedAt: input.nowIso,
    endedAt: null,
    plannedEndAt,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
    isEdited: false,
  };
}

export function createManualSegment(input: {
  state: TrackableState;
  taskName?: string | null;
  startedAt: string;
  endedAt: string;
  settings: LifeSettings;
  nowIso?: string;
}): TimelineSegment {
  const startMs = new Date(input.startedAt).getTime();
  const endMs = new Date(input.endedAt).getTime();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error("手动补记的结束时间需要晚于开始时间。");
  }

  const nowIso = input.nowIso ?? new Date().toISOString();

  return {
    id: createId("segment"),
    stateRunId: createId("run"),
    state: input.state,
    taskName: normalizeTaskName(input.taskName),
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    plannedEndAt: addMinutes(input.startedAt, getTargetMinutes(input.state, input.settings)),
    createdAt: nowIso,
    updatedAt: nowIso,
    isEdited: true,
  };
}

export function closeSegment(segment: TimelineSegment, endedAt: string): TimelineSegment {
  return {
    ...segment,
    endedAt,
    updatedAt: endedAt,
  };
}

export function deriveTimerSnapshot(input: {
  state: LifeState;
  activeSegment: TimelineSegment | null;
  settings: LifeSettings;
  nowIso: string;
  extensionMinutes?: number;
}): TimerSnapshot {
  const { activeSegment, nowIso, settings, state } = input;

  if (!activeSegment || state === "idle" || state === "paused") {
    return {
      state,
      taskName: activeSegment?.taskName ?? null,
      startedAt: activeSegment?.startedAt ?? null,
      dueAt: activeSegment?.plannedEndAt ?? null,
      elapsedSeconds: 0,
      remainingSeconds: 0,
      overtimeSeconds: 0,
      targetMinutes: state === "rest" ? settings.restMinutes : settings.busyMinutes,
      extensionMinutes: input.extensionMinutes ?? 0,
      isDue: false,
    };
  }

  const elapsedSeconds = secondsBetween(activeSegment.startedAt, nowIso);
  const remainingSeconds = Math.max(0, secondsBetween(nowIso, activeSegment.plannedEndAt));
  const overtimeSeconds = Math.max(0, secondsBetween(activeSegment.plannedEndAt, nowIso));

  return {
    state,
    taskName: activeSegment.taskName,
    startedAt: activeSegment.startedAt,
    dueAt: activeSegment.plannedEndAt,
    elapsedSeconds,
    remainingSeconds,
    overtimeSeconds,
    targetMinutes: getTargetMinutes(activeSegment.state, settings),
    extensionMinutes: input.extensionMinutes ?? 0,
    isDue: overtimeSeconds > 0,
  };
}

export function extendDueAt(currentDueAt: string, nowIso: string, minutes: number): string {
  const baseMs = Math.max(new Date(currentDueAt).getTime(), new Date(nowIso).getTime());
  return new Date(baseMs + minutes * 60_000).toISOString();
}

export function calculateTodayStats(
  segments: TimelineSegment[],
  dayStartIso: string,
  dayEndIso: string,
  nowIso = new Date().toISOString(),
): TodayStats {
  const taskSeconds = new Map<string, number>();
  let busySeconds = 0;
  let restSeconds = 0;
  let overtimeBusySeconds = 0;
  let overtimeRestSeconds = 0;
  let unmarkedSeconds = 0;

  for (const segment of segments) {
    const clipped = clipRange(segment.startedAt, segment.endedAt ?? nowIso, dayStartIso, dayEndIso);
    if (!clipped) continue;

    const seconds = secondsBetween(clipped.start, clipped.end);
    const overtime = calculateOvertimeSeconds(segment, clipped.start, clipped.end);

    if (segment.state === "busy") {
      busySeconds += seconds;
      overtimeBusySeconds += overtime;
      const task = segment.taskName ?? UNMARKED_TASK;
      taskSeconds.set(task, (taskSeconds.get(task) ?? 0) + seconds);
      if (!segment.taskName) unmarkedSeconds += seconds;
    } else {
      restSeconds += seconds;
      overtimeRestSeconds += overtime;
    }
  }

  return {
    busySeconds,
    restSeconds,
    overtimeBusySeconds,
    overtimeRestSeconds,
    taskStats: [...taskSeconds.entries()]
      .map(([taskName, seconds]) => ({ taskName, seconds }))
      .sort((a, b) => b.seconds - a.seconds || a.taskName.localeCompare(b.taskName)),
    unmarkedSeconds,
  };
}

export function splitSegmentAt(segment: TimelineSegment, splitAtIso: string, nowIso = new Date().toISOString()): TimelineSegment[] {
  const splitMs = new Date(splitAtIso).getTime();
  const startMs = new Date(segment.startedAt).getTime();
  const endMs = new Date(segment.endedAt ?? nowIso).getTime();

  if (splitMs <= startMs || splitMs >= endMs) {
    return [segment];
  }

  return [
    {
      ...segment,
      endedAt: splitAtIso,
      updatedAt: nowIso,
      isEdited: true,
    },
    {
      ...segment,
      id: createId("segment"),
      startedAt: splitAtIso,
      endedAt: segment.endedAt,
      createdAt: nowIso,
      updatedAt: nowIso,
      isEdited: true,
    },
  ];
}

export function canMergeSegments(left: TimelineSegment, right: TimelineSegment): boolean {
  return (
    left.state === right.state &&
    left.stateRunId === right.stateRunId &&
    left.taskName === right.taskName &&
    left.endedAt === right.startedAt &&
    left.plannedEndAt === right.plannedEndAt
  );
}

export function mergeSegments(left: TimelineSegment, right: TimelineSegment, nowIso = new Date().toISOString()): TimelineSegment {
  return {
    ...left,
    endedAt: right.endedAt,
    updatedAt: nowIso,
    isEdited: true,
  };
}

export function getLocalDayRange(date = new Date()): { startIso: string; endIso: string } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const restSeconds = seconds % 60;

  if (hours > 0) return `${hours}小时${minutes.toString().padStart(2, "0")}分`;
  if (minutes > 0) return `${minutes}分${restSeconds.toString().padStart(2, "0")}秒`;
  return `${restSeconds}秒`;
}

export function normalizeTaskName(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function calculateOvertimeSeconds(segment: TimelineSegment, clippedStartIso: string, clippedEndIso: string): number {
  const overtimeStart = Math.max(new Date(segment.plannedEndAt).getTime(), new Date(clippedStartIso).getTime());
  const overtimeEnd = new Date(clippedEndIso).getTime();
  return Math.max(0, Math.round((overtimeEnd - overtimeStart) / 1000));
}

function clipRange(
  startIso: string,
  endIso: string,
  dayStartIso: string,
  dayEndIso: string,
): { start: string; end: string } | null {
  const startMs = Math.max(new Date(startIso).getTime(), new Date(dayStartIso).getTime());
  const endMs = Math.min(new Date(endIso).getTime(), new Date(dayEndIso).getTime());

  if (endMs <= startMs) return null;

  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
  };
}
