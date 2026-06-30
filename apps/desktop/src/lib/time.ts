import type { TimelineSegment } from "@lifemonitor/core";

export const RULER_STEP_MINUTES = 1;
export const DAY_MINUTES = 24 * 60;

export interface TimelineInterval {
  id?: string;
  startedAt: string;
  endedAt: string | null;
}

export function formatDateTimeLabel(isoDate: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoDate));
}

export function timelineIntervalsOverlap(
  left: TimelineInterval,
  right: TimelineInterval,
  nowIso = new Date().toISOString(),
): boolean {
  const leftStart = new Date(left.startedAt).getTime();
  const leftEnd = new Date(left.endedAt ?? nowIso).getTime();
  const rightStart = new Date(right.startedAt).getTime();
  const rightEnd = new Date(right.endedAt ?? nowIso).getTime();

  if (![leftStart, leftEnd, rightStart, rightEnd].every(Number.isFinite)) return false;
  return leftStart < rightEnd && leftEnd > rightStart;
}

export function findOverlappingTimelineSegment<TSegment extends TimelineInterval>(
  segments: TSegment[],
  candidate: TimelineInterval,
  ignoredSegmentId?: string,
): TSegment | null {
  return segments.find((segment) => {
    if (ignoredSegmentId && segment.id === ignoredSegmentId) return false;
    return timelineIntervalsOverlap(segment, candidate);
  }) ?? null;
}

export function durationFor(segment: TimelineSegment): number {
  const end = segment.endedAt ?? new Date().toISOString();
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(segment.startedAt).getTime()) / 1000));
}

export function segmentOvertimeSeconds(segment: TimelineSegment): number {
  const end = segment.endedAt ?? new Date().toISOString();
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(segment.plannedEndAt).getTime()) / 1000));
}

export function segmentUndertimeSeconds(segment: TimelineSegment): number {
  if (!segment.endedAt) return 0;
  return Math.max(
    0,
    Math.round((new Date(segment.plannedEndAt).getTime() - new Date(segment.endedAt).getTime()) / 1000),
  );
}

export function midpointIso(segment: TimelineSegment): string {
  const end = segment.endedAt ?? new Date().toISOString();
  const midpoint = new Date((new Date(segment.startedAt).getTime() + new Date(end).getTime()) / 2);
  return midpoint.toISOString();
}

export function toLocalInputValue(isoDate: string, includeSeconds = false): string {
  const date = new Date(isoDate);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, includeSeconds ? 19 : 16);
}

export function maybeFromLocalInputValue(value: string): string | null {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function isoFromLocalTimeInput(selectedDate: string, value: string): string | null {
  const parsed = parseLocalTimeInput(value);
  if (!parsed) return null;

  const date = localDateFromKey(selectedDate);
  date.setHours(parsed.hours, parsed.minutes, parsed.seconds, 0);
  return date.toISOString();
}

export function timeInputValueFromIso(isoDate: string, includeSeconds = false): string {
  const date = new Date(isoDate);
  const value = timeInputValueFromMinute(getLocalMinuteOfDay(date));
  if (!includeSeconds) return value;

  return `${value}:${date.getSeconds().toString().padStart(2, "0")}`;
}

export function formatTimelineBoundary(isoDate: string, selectedDate: string, includeSeconds = false): string {
  const date = new Date(isoDate);
  if (isIsoOnLocalDate(isoDate, selectedDate)) return formatLocalTime(date, includeSeconds);

  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: includeSeconds ? "2-digit" : undefined,
  }).format(date);
}

export function formatTimelineRangeLabel(startedAt: string, endedAt: string | null, selectedDate: string): string {
  if (!endedAt) return `${formatTimelineBoundary(startedAt, selectedDate)} - 进行中`;

  const start = new Date(startedAt);
  const end = new Date(endedAt);
  const durationMs = end.getTime() - start.getTime();
  const sameDisplayedMinute =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate() &&
    start.getHours() === end.getHours() &&
    start.getMinutes() === end.getMinutes();
  const includeSeconds = durationMs < 60_000 || sameDisplayedMinute;

  return `${formatTimelineBoundary(startedAt, selectedDate, includeSeconds)} - ${formatTimelineBoundary(
    endedAt,
    selectedDate,
    includeSeconds,
  )}`;
}

export function isIsoOnLocalDate(isoDate: string, selectedDate: string): boolean {
  return toDateInputValue(new Date(isoDate)) === selectedDate;
}

export function normalizeTimelineDraft(segment: TimelineSegment): TimelineSegment | null {
  const startedAt = maybeFromLocalInputValue(segment.startedAt);
  const endedAt = segment.endedAt ? maybeFromLocalInputValue(segment.endedAt) : null;
  if (!startedAt || (segment.endedAt && !endedAt)) return null;

  return {
    ...segment,
    startedAt,
    endedAt,
  };
}

export function hasTimelineDraftChanges(draft: TimelineSegment, segment: TimelineSegment): boolean {
  return (
    draft.state !== segment.state ||
    draft.taskName !== segment.taskName ||
    draft.note !== segment.note ||
    draft.startedAt !== segment.startedAt ||
    draft.endedAt !== segment.endedAt
  );
}

export function isPersistableTimelineDraft(segment: TimelineSegment, isActive: boolean): boolean {
  const startMs = new Date(segment.startedAt).getTime();
  if (!Number.isFinite(startMs)) return false;
  if (segment.endedAt === null) return isActive;

  const endMs = new Date(segment.endedAt).getTime();
  return Number.isFinite(endMs) && endMs > startMs;
}

export function minuteFromTimeInput(value: string): number | null {
  const parsed = parseLocalTimeInput(value);
  if (!parsed) return null;
  const { hours, minutes } = parsed;
  return snapMinute(hours * 60 + minutes);
}

function parseLocalTimeInput(value: string): { hours: number; minutes: number; seconds: number } | null {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] ? Number(match[3]) : 0;
  if (hours > 23 || minutes > 59 || seconds > 59) return null;

  return { hours, minutes, seconds };
}

export function isoFromLocalMinute(selectedDate: string, minute: number): string {
  const date = localDateFromKey(selectedDate);
  date.setMinutes(minute, 0, 0);
  return date.toISOString();
}

export function timeInputValueFromMinute(minute: number): string {
  const safeMinute = clamp(Math.floor(minute), 0, DAY_MINUTES - RULER_STEP_MINUTES);
  const hours = Math.floor(safeMinute / 60);
  const minutes = safeMinute % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

function formatLocalTime(date: Date, includeSeconds: boolean): string {
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  if (!includeSeconds) return `${hours}:${minutes}`;

  const seconds = date.getSeconds().toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

export function formatMinuteLabel(minute: number): string {
  if (minute >= DAY_MINUTES) return "24:00";
  return timeInputValueFromMinute(minute);
}

export function formatHourMark(minute: number): string {
  if (minute >= DAY_MINUTES) return "24";
  return `${Math.floor(minute / 60).toString().padStart(2, "0")}:00`;
}

export function formatRulerZoomLabel(zoom: number): string {
  return `${zoom.toFixed(zoom % 1 === 0 ? 0 : 1)}x`;
}

export function toRulerPercent(minute: number): number {
  return (minute / DAY_MINUTES) * 100;
}

export function snapMinute(minute: number): number {
  return Math.round(minute / RULER_STEP_MINUTES) * RULER_STEP_MINUTES;
}

export function floorMinuteToStep(minute: number): number {
  return Math.floor(minute / RULER_STEP_MINUTES) * RULER_STEP_MINUTES;
}

export function getLocalMinuteOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function localDateFromKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDateLabel(value: string, isToday: boolean): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const formatted = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);

  return isToday ? `今天 ${formatted}` : formatted;
}

export function clampMinutes(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function percentage(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

export function formatMiniDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const restSeconds = seconds % 60;

  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, "0")}`;
  return `${minutes}:${restSeconds.toString().padStart(2, "0")}`;
}
