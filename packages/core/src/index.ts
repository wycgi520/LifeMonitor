export type LifeState = "idle" | "busy" | "rest" | "paused";

export type TrackableState = "busy" | "rest";

export type ReminderPolicy = "stop-at-timeout";

export type CloseWindowBehavior = "ask" | "minimize-to-tray" | "quit";

export type SummaryScope = "day" | "week";

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
  note: string | null;
  startedAt: string;
  endedAt: string | null;
  plannedEndAt: string;
  createdAt: string;
  updatedAt: string;
  isEdited: boolean;
}

export interface SummaryEntry {
  scope: SummaryScope;
  key: string;
  content: string;
  updatedAt: string;
}

export interface LifeDataExport {
  app: "LifeMonitor";
  version: 2;
  exportedAt: string;
  settings: LifeSettings;
  segments: TimelineSegment[];
  summaries: SummaryEntry[];
}

export interface LifeDataExportInput {
  settings: unknown;
  segments: unknown[];
  summaries: unknown[];
  exportedAt?: string;
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
  idleSeconds: number;
  overtimeBusySeconds: number;
  overtimeRestSeconds: number;
  undertimeBusySeconds: number;
  undertimeRestSeconds: number;
  pomodoroCount: number;
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
export const EXPORT_APP = "LifeMonitor";
export const EXPORT_VERSION = 2;

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
  note?: string | null;
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
    note: normalizeNote(input.note),
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
  note?: string | null;
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
    note: normalizeNote(input.note),
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
  let undertimeBusySeconds = 0;
  let undertimeRestSeconds = 0;
  let unmarkedSeconds = 0;
  const trackedIntervals: Array<{ start: string; end: string }> = [];

  for (const segment of segments) {
    const clipped = clipRange(segment.startedAt, segment.endedAt ?? nowIso, dayStartIso, dayEndIso);
    if (!clipped) continue;
    trackedIntervals.push(clipped);

    const seconds = secondsBetween(clipped.start, clipped.end);
    const overtime = calculateOvertimeSeconds(segment, clipped.start, clipped.end);
    const undertime = calculateUndertimeSeconds(segment, dayStartIso, dayEndIso);

    if (segment.state === "busy") {
      busySeconds += seconds;
      overtimeBusySeconds += overtime;
      undertimeBusySeconds += undertime;
      const task = segment.taskName ?? UNMARKED_TASK;
      taskSeconds.set(task, (taskSeconds.get(task) ?? 0) + seconds);
      if (!segment.taskName) unmarkedSeconds += seconds;
    } else {
      restSeconds += seconds;
      overtimeRestSeconds += overtime;
      undertimeRestSeconds += undertime;
    }
  }

  return {
    busySeconds,
    restSeconds,
    idleSeconds: calculateIdleSeconds(trackedIntervals, dayStartIso, dayEndIso, nowIso),
    overtimeBusySeconds,
    overtimeRestSeconds,
    undertimeBusySeconds,
    undertimeRestSeconds,
    pomodoroCount: calculatePomodoroCount(segments, dayStartIso, dayEndIso),
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
  return left.state === right.state && normalizeTaskName(left.taskName) === normalizeTaskName(right.taskName);
}

export function mergeSegments(left: TimelineSegment, right: TimelineSegment, nowIso = new Date().toISOString()): TimelineSegment {
  return {
    ...left,
    note: mergeNotes(left.note, right.note),
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

export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isLocalDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function dateFromLocalDateKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function getDayRangeForDateKey(value: string): { startIso: string; endIso: string } {
  return getLocalDayRange(dateFromLocalDateKey(value));
}

export function shiftLocalDateKey(value: string, days: number): string {
  const date = dateFromLocalDateKey(value);
  date.setDate(date.getDate() + days);
  return toLocalDateKey(date);
}

export function getWeekKeyForDateKey(value: string): string {
  const date = dateFromLocalDateKey(value);
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + mondayOffset);
  return toLocalDateKey(date);
}

export function getRunPlannedEndAt(
  activeSegment: TimelineSegment,
  segments: TimelineSegment[],
  settings: LifeSettings,
  extensionMinutes: number,
): string {
  const runStartedAt = getRunStartedAt(activeSegment, segments);
  return addMinutes(runStartedAt, getTargetMinutes(activeSegment.state, settings) + extensionMinutes);
}

export function getRunExtensionMinutes(
  activeSegment: TimelineSegment,
  segments: TimelineSegment[],
  settings: LifeSettings,
  trackedExtensionMinutes: number,
): number {
  const runStartedAt = getRunStartedAt(activeSegment, segments);
  const baseEnd = addMinutes(runStartedAt, getTargetMinutes(activeSegment.state, settings));
  const persistedExtensionMinutes = Math.round(
    (new Date(activeSegment.plannedEndAt).getTime() - new Date(baseEnd).getTime()) / 60_000,
  );

  return Math.max(0, trackedExtensionMinutes, persistedExtensionMinutes);
}

function getRunStartedAt(activeSegment: TimelineSegment, segments: TimelineSegment[]): string {
  return [...segments, activeSegment]
    .filter((segment) => segment.stateRunId === activeSegment.stateRunId)
    .reduce(
      (earliest, segment) => (segment.startedAt < earliest ? segment.startedAt : earliest),
      activeSegment.startedAt,
    );
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

export function normalizeNote(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function mergeNotes(left?: string | null, right?: string | null): string | null {
  const leftNote = normalizeNote(left);
  const rightNote = normalizeNote(right);
  if (!leftNote) return rightNote;
  if (!rightNote || leftNote === rightNote) return leftNote;
  return `${leftNote}\n${rightNote}`;
}

export function parseLifeDataExport(raw: string): LifeDataExport {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("导入文件不是有效的 JSON。");
  }

  if (!isRecord(parsed)) {
    throw new Error("导入文件格式不正确。");
  }

  const segmentValues = parsed.segments;
  if (!Array.isArray(segmentValues)) {
    throw new Error("导入文件缺少记录列表。");
  }

  return buildLifeDataExport({
    settings: parsed.settings,
    segments: segmentValues,
    summaries: Array.isArray(parsed.summaries) ? parsed.summaries : [],
    exportedAt: readOptionalIso(parsed.exportedAt) ?? new Date().toISOString(),
  });
}

export function buildLifeDataExport(data: LifeDataExportInput): LifeDataExport {
  const settings = normalizeImportedSettings(data.settings);
  const segments = sortSegments(
    data.segments.map((segment, index) => normalizeImportedSegment(segment, index, settings)),
  );
  const summaries = sortSummaries(data.summaries.map((summary, index) => normalizeImportedSummary(summary, index)));
  assertImportConsistency(segments);

  return {
    app: EXPORT_APP,
    version: EXPORT_VERSION,
    exportedAt: readOptionalIso(data.exportedAt) ?? new Date().toISOString(),
    settings,
    segments,
    summaries,
  };
}

function normalizeImportedSettings(value: unknown): LifeSettings {
  const source = isRecord(value) ? value : {};
  return {
    busyMinutes: readBoundedInteger(source.busyMinutes, DEFAULT_SETTINGS.busyMinutes, 1, 240),
    restMinutes: readBoundedInteger(source.restMinutes, DEFAULT_SETTINGS.restMinutes, 1, 120),
    soundEnabled: typeof source.soundEnabled === "boolean" ? source.soundEnabled : DEFAULT_SETTINGS.soundEnabled,
    alwaysOnTop: typeof source.alwaysOnTop === "boolean" ? source.alwaysOnTop : DEFAULT_SETTINGS.alwaysOnTop,
    autostart: typeof source.autostart === "boolean" ? source.autostart : DEFAULT_SETTINGS.autostart,
    closeWindowBehavior: isCloseWindowBehavior(source.closeWindowBehavior)
      ? source.closeWindowBehavior
      : DEFAULT_SETTINGS.closeWindowBehavior,
    quickTasks: normalizeQuickTasks(source.quickTasks),
    reminderPolicy: DEFAULT_SETTINGS.reminderPolicy,
  };
}

function normalizeImportedSegment(value: unknown, index: number, settings: LifeSettings): TimelineSegment {
  if (!isRecord(value)) {
    throw new Error(`导入文件中第 ${index + 1} 条记录格式不正确。`);
  }

  const state = readTrackableState(value.state, index);
  const startedAt = readRequiredIso(value.startedAt, "开始时间", index);
  const endedAt = value.endedAt === null ? null : readRequiredIso(value.endedAt, "结束时间", index);
  const plannedEndAt =
    readOptionalIso(value.plannedEndAt) ?? addMinutes(startedAt, getTargetMinutes(state, settings));
  const nowIso = new Date().toISOString();

  if (endedAt && new Date(endedAt).getTime() <= new Date(startedAt).getTime()) {
    throw new Error(`导入文件中第 ${index + 1} 条记录的结束时间需要晚于开始时间。`);
  }

  return {
    id: readRequiredString(value.id, "记录 ID", index),
    stateRunId: readRequiredString(value.stateRunId, "状态 ID", index),
    state,
    taskName: typeof value.taskName === "string" ? normalizeTaskName(value.taskName) : null,
    note: typeof value.note === "string" ? normalizeNote(value.note) : null,
    startedAt,
    endedAt,
    plannedEndAt,
    createdAt: readOptionalIso(value.createdAt) ?? nowIso,
    updatedAt: readOptionalIso(value.updatedAt) ?? nowIso,
    isEdited: typeof value.isEdited === "boolean" ? value.isEdited : Boolean(value.isEdited),
  };
}

function normalizeImportedSummary(value: unknown, index: number): SummaryEntry {
  if (!isRecord(value)) {
    throw new Error(`导入文件中第 ${index + 1} 条总结格式不正确。`);
  }

  const scope = readSummaryScope(value.scope, index);
  const key = readRequiredString(value.key, "总结日期", index);
  const content = typeof value.content === "string" ? value.content.trim() : "";
  const updatedAt = readOptionalIso(value.updatedAt) ?? new Date().toISOString();

  return {
    scope,
    key,
    content,
    updatedAt,
  };
}

function assertImportConsistency(segments: TimelineSegment[]): void {
  const ids = new Set<string>();
  let openCount = 0;

  for (const segment of segments) {
    if (ids.has(segment.id)) {
      throw new Error(`导入文件中存在重复记录 ID：${segment.id}`);
    }
    ids.add(segment.id);

    if (segment.endedAt === null) {
      openCount += 1;
    }
  }

  if (openCount > 1) {
    throw new Error("导入文件中存在多个进行中的记录。");
  }
}

function sortSegments(segments: TimelineSegment[]): TimelineSegment[] {
  return [...segments].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

function sortSummaries(summaries: SummaryEntry[]): SummaryEntry[] {
  return [...summaries].sort(
    (left, right) => left.scope.localeCompare(right.scope) || left.key.localeCompare(right.key),
  );
}

function normalizeQuickTasks(value: unknown): string[] {
  if (!Array.isArray(value)) return DEFAULT_SETTINGS.quickTasks;

  const tasks = value
    .filter((task): task is string => typeof task === "string")
    .map((task) => task.trim())
    .filter(Boolean);

  return [...new Set(tasks)];
}

function readTrackableState(value: unknown, index: number): TrackableState {
  if (value === "busy" || value === "rest") return value;
  throw new Error(`导入文件中第 ${index + 1} 条记录的状态无效。`);
}

function readSummaryScope(value: unknown, index: number): SummaryScope {
  if (value === "day" || value === "week") return value;
  throw new Error(`导入文件中第 ${index + 1} 条总结的范围无效。`);
}

function readRequiredString(value: unknown, label: string, index: number): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(`导入文件中第 ${index + 1} 条记录的${label}无效。`);
}

function readRequiredIso(value: unknown, label: string, index: number): string {
  const iso = readOptionalIso(value);
  if (iso) return iso;
  throw new Error(`导入文件中第 ${index + 1} 条记录的${label}无效。`);
}

function readOptionalIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

function readBoundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function isCloseWindowBehavior(value: unknown): value is LifeSettings["closeWindowBehavior"] {
  return value === "ask" || value === "minimize-to-tray" || value === "quit";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function calculateOvertimeSeconds(segment: TimelineSegment, clippedStartIso: string, clippedEndIso: string): number {
  const overtimeStart = Math.max(new Date(segment.plannedEndAt).getTime(), new Date(clippedStartIso).getTime());
  const overtimeEnd = new Date(clippedEndIso).getTime();
  return Math.max(0, Math.round((overtimeEnd - overtimeStart) / 1000));
}

function calculateUndertimeSeconds(segment: TimelineSegment, dayStartIso: string, dayEndIso: string): number {
  if (!segment.endedAt) return 0;

  const clipped = clipRange(segment.endedAt, segment.plannedEndAt, dayStartIso, dayEndIso);
  if (!clipped) return 0;
  return secondsBetween(clipped.start, clipped.end);
}

function calculateIdleSeconds(
  trackedIntervals: Array<{ start: string; end: string }>,
  dayStartIso: string,
  dayEndIso: string,
  nowIso: string,
): number {
  const merged = mergeIntervals(trackedIntervals);
  if (merged.length === 0) return 0;

  let idleSeconds = 0;
  for (let index = 1; index < merged.length; index += 1) {
    idleSeconds += secondsBetween(merged[index - 1].end, merged[index].start);
  }

  if (isWithinRange(nowIso, dayStartIso, dayEndIso)) {
    const lastInterval = merged[merged.length - 1];
    const idleEnd = nowIso < dayEndIso ? nowIso : dayEndIso;
    idleSeconds += secondsBetween(lastInterval.end, idleEnd);
  }

  return idleSeconds;
}

function mergeIntervals(intervals: Array<{ start: string; end: string }>): Array<{ start: string; end: string }> {
  const sorted = [...intervals]
    .filter((interval) => interval.end > interval.start)
    .sort((left, right) => left.start.localeCompare(right.start));
  const merged: Array<{ start: string; end: string }> = [];

  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || interval.start > previous.end) {
      merged.push({ ...interval });
      continue;
    }

    if (interval.end > previous.end) previous.end = interval.end;
  }

  return merged;
}

interface StateRun {
  stateRunId: string;
  state: TrackableState;
  startedAt: string;
  endedAt: string | null;
}

function calculatePomodoroCount(segments: TimelineSegment[], dayStartIso: string, dayEndIso: string): number {
  const runs = collectStateRuns(segments).sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  let count = 0;

  for (let index = 1; index < runs.length; index += 1) {
    const previous = runs[index - 1];
    const current = runs[index];
    if (previous.state !== "busy" || current.state !== "rest") continue;
    if (!previous.endedAt || !current.endedAt) continue;
    if (!isWithinRange(current.endedAt, dayStartIso, dayEndIso)) continue;
    count += 1;
  }

  return count;
}

function collectStateRuns(segments: TimelineSegment[]): StateRun[] {
  const runs = new Map<string, StateRun>();

  for (const segment of segments) {
    const current = runs.get(segment.stateRunId);
    if (!current) {
      runs.set(segment.stateRunId, {
        stateRunId: segment.stateRunId,
        state: segment.state,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
      });
      continue;
    }

    current.startedAt = current.startedAt < segment.startedAt ? current.startedAt : segment.startedAt;
    if (!current.endedAt || !segment.endedAt) {
      current.endedAt = null;
    } else if (segment.endedAt > current.endedAt) {
      current.endedAt = segment.endedAt;
    }
  }

  return [...runs.values()];
}

function isWithinRange(isoDate: string, startIso: string, endIso: string): boolean {
  return isoDate >= startIso && isoDate < endIso;
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
