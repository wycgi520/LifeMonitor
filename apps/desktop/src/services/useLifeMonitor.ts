import {
  DEFAULT_SETTINGS,
  calculateTodayStats,
  canMergeSegments,
  closeSegment,
  createSegment,
  deriveTimerSnapshot,
  extendDueAt,
  getLocalDayRange,
  normalizeTaskName,
  splitSegmentAt,
  type LifeSettings,
  type LifeState,
  type TimelineSegment,
  type TodayStats,
  type TrackableState,
} from "@lifemonitor/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { showReminderNotification } from "./notifications";
import { syncPlatformSettings } from "./platform";
import { createRepository, type LifeRepository } from "./repository";

interface PausedContext {
  state: TrackableState;
  taskName: string | null;
  stateRunId: string;
  remainingMs: number;
}

export interface LifeMonitorController {
  loading: boolean;
  error: string | null;
  state: LifeState;
  settings: LifeSettings;
  taskDraft: string;
  setTaskDraft: (value: string) => void;
  segments: TimelineSegment[];
  activeSegment: TimelineSegment | null;
  stats: TodayStats;
  snapshot: ReturnType<typeof deriveTimerSnapshot>;
  reminderVisible: boolean;
  startBusy: (taskName?: string | null) => Promise<void>;
  startRest: (taskName?: string | null) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  changeTask: (taskName: string | null) => Promise<void>;
  extend: (minutes: number) => Promise<void>;
  acknowledgeReminder: () => void;
  saveSettings: (settings: LifeSettings) => Promise<void>;
  updateSegment: (segment: TimelineSegment) => Promise<void>;
  splitSegment: (segment: TimelineSegment, splitAtIso: string) => Promise<void>;
  mergeWithPrevious: (segment: TimelineSegment) => Promise<void>;
  deleteSegment: (segment: TimelineSegment) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useLifeMonitor(): LifeMonitorController {
  const [repository, setRepository] = useState<LifeRepository | null>(null);
  const [settings, setSettings] = useState<LifeSettings>(DEFAULT_SETTINGS);
  const [state, setState] = useState<LifeState>("idle");
  const [taskDraft, setTaskDraft] = useState("");
  const [segments, setSegments] = useState<TimelineSegment[]>([]);
  const [activeSegment, setActiveSegment] = useState<TimelineSegment | null>(null);
  const [pausedContext, setPausedContext] = useState<PausedContext | null>(null);
  const [acknowledgedRunIds, setAcknowledgedRunIds] = useState<Set<string>>(() => new Set());
  const [notifiedRunIds, setNotifiedRunIds] = useState<Set<string>>(() => new Set());
  const [extensionMinutesByRun, setExtensionMinutesByRun] = useState<Record<string, number>>({});
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);

  const refresh = useCallback(async () => {
    if (!repository) return;
    const { startIso, endIso } = getLocalDayRange();
    setSegments(await repository.listSegments(startIso, endIso));
  }, [repository]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const init = async () => {
      try {
        const nextRepository = await createRepository();
        const nextSettings = await nextRepository.loadSettings();
        const openSegment = await nextRepository.getOpenSegment();
        const { startIso, endIso } = getLocalDayRange();

        setRepository(nextRepository);
        setSettings(nextSettings);
        setActiveSegment(openSegment);
        setState(openSegment?.state ?? "idle");
        setTaskDraft(openSegment?.taskName ?? "");
        setSegments(await nextRepository.listSegments(startIso, endIso));
        await syncPlatformSettings(nextSettings);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setLoading(false);
      }
    };

    void init();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowIso(new Date().toISOString());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const stats = useMemo(() => {
    const { startIso, endIso } = getLocalDayRange();
    return calculateTodayStats(segments, startIso, endIso, nowIso);
  }, [nowIso, segments]);

  const snapshot = useMemo(
    () =>
      deriveTimerSnapshot({
        state,
        activeSegment,
        settings,
        nowIso,
        extensionMinutes: activeSegment ? extensionMinutesByRun[activeSegment.stateRunId] ?? 0 : 0,
      }),
    [activeSegment, extensionMinutesByRun, nowIso, settings, state],
  );

  const reminderVisible = Boolean(
    activeSegment && snapshot.isDue && !acknowledgedRunIds.has(activeSegment.stateRunId),
  );

  useEffect(() => {
    if (!reminderVisible || !activeSegment || notifiedRunIds.has(activeSegment.stateRunId)) return;

    setNotifiedRunIds((previous) => new Set(previous).add(activeSegment.stateRunId));
    void showReminderNotification(snapshot, settings);
  }, [activeSegment, notifiedRunIds, reminderVisible, settings, snapshot]);

  const persistAndRefresh = useCallback(
    async (operation: (repo: LifeRepository) => Promise<void>) => {
      if (!repository) return;
      try {
        await operation(repository);
        const { startIso, endIso } = getLocalDayRange();
        setSegments(await repository.listSegments(startIso, endIso));
        setError(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    },
    [repository],
  );

  const closeCurrent = useCallback(
    async (repo: LifeRepository, endedAt: string) => {
      if (!activeSegment) return null;
      const closed = closeSegment(activeSegment, endedAt);
      await repo.updateSegment(closed);
      return closed;
    },
    [activeSegment],
  );

  const switchToState = useCallback(
    async (nextState: TrackableState, taskName?: string | null) => {
      const now = new Date().toISOString();
      const normalizedTask = normalizeTaskName(taskName ?? taskDraft);

      await persistAndRefresh(async (repo) => {
        await closeCurrent(repo, now);
        const nextSegment = createSegment({
          state: nextState,
          taskName: normalizedTask,
          nowIso: now,
          settings,
        });
        await repo.insertSegment(nextSegment);
        setActiveSegment(nextSegment);
        setState(nextState);
        setTaskDraft(nextSegment.taskName ?? "");
        setPausedContext(null);
      });
    },
    [closeCurrent, persistAndRefresh, settings, taskDraft],
  );

  const startBusy = useCallback(
    (taskName?: string | null) => switchToState("busy", taskName),
    [switchToState],
  );

  const startRest = useCallback(
    (taskName?: string | null) => switchToState("rest", taskName),
    [switchToState],
  );

  const pause = useCallback(async () => {
    if (!activeSegment) return;
    const now = new Date().toISOString();
    const remainingMs = Math.max(0, new Date(activeSegment.plannedEndAt).getTime() - new Date(now).getTime());

    await persistAndRefresh(async (repo) => {
      await closeCurrent(repo, now);
      setPausedContext({
        state: activeSegment.state,
        taskName: activeSegment.taskName,
        stateRunId: activeSegment.stateRunId,
        remainingMs,
      });
      setActiveSegment(null);
      setState("paused");
    });
  }, [activeSegment, closeCurrent, persistAndRefresh]);

  const resume = useCallback(async () => {
    if (!pausedContext) {
      await switchToState("busy", taskDraft);
      return;
    }

    const now = new Date().toISOString();
    const plannedEndAt = new Date(new Date(now).getTime() + pausedContext.remainingMs).toISOString();

    await persistAndRefresh(async (repo) => {
      const nextSegment = createSegment({
        state: pausedContext.state,
        taskName: pausedContext.taskName,
        nowIso: now,
        settings,
        stateRunId: pausedContext.stateRunId,
        plannedEndAt,
      });
      await repo.insertSegment(nextSegment);
      setActiveSegment(nextSegment);
      setState(pausedContext.state);
      setTaskDraft(nextSegment.taskName ?? "");
      setPausedContext(null);
    });
  }, [pausedContext, persistAndRefresh, settings, switchToState, taskDraft]);

  const changeTask = useCallback(
    async (taskName: string | null) => {
      const normalizedTask = normalizeTaskName(taskName);
      setTaskDraft(normalizedTask ?? "");
      if (!activeSegment) return;

      const now = new Date().toISOString();
      await persistAndRefresh(async (repo) => {
        await closeCurrent(repo, now);
        const nextSegment = createSegment({
          state: activeSegment.state,
          taskName: normalizedTask,
          nowIso: now,
          settings,
          stateRunId: activeSegment.stateRunId,
          plannedEndAt: activeSegment.plannedEndAt,
        });
        await repo.insertSegment(nextSegment);
        setActiveSegment(nextSegment);
      });
    },
    [activeSegment, closeCurrent, persistAndRefresh, settings],
  );

  const extend = useCallback(
    async (minutes: number) => {
      if (!activeSegment) return;
      const now = new Date().toISOString();
      const plannedEndAt = extendDueAt(activeSegment.plannedEndAt, now, minutes);

      await persistAndRefresh(async (repo) => {
        await repo.updateRunPlannedEnd(activeSegment.stateRunId, plannedEndAt, now);
        setActiveSegment({
          ...activeSegment,
          plannedEndAt,
          updatedAt: now,
        });
        setExtensionMinutesByRun((previous) => ({
          ...previous,
          [activeSegment.stateRunId]: (previous[activeSegment.stateRunId] ?? 0) + minutes,
        }));
        setAcknowledgedRunIds((previous) => {
          const next = new Set(previous);
          next.delete(activeSegment.stateRunId);
          return next;
        });
      });
    },
    [activeSegment, persistAndRefresh],
  );

  const acknowledgeReminder = useCallback(() => {
    if (!activeSegment) return;
    setAcknowledgedRunIds((previous) => new Set(previous).add(activeSegment.stateRunId));
  }, [activeSegment]);

  const saveSettings = useCallback(
    async (nextSettings: LifeSettings) => {
      await persistAndRefresh(async (repo) => {
        await repo.saveSettings(nextSettings);
        setSettings(nextSettings);
        await syncPlatformSettings(nextSettings);
      });
    },
    [persistAndRefresh],
  );

  const updateSegment = useCallback(
    async (segment: TimelineSegment) => {
      const updated = {
        ...segment,
        taskName: normalizeTaskName(segment.taskName),
        updatedAt: new Date().toISOString(),
        isEdited: true,
      };

      await persistAndRefresh(async (repo) => {
        await repo.updateSegment(updated);
        if (activeSegment?.id === updated.id) setActiveSegment(updated);
      });
    },
    [activeSegment, persistAndRefresh],
  );

  const splitSegment = useCallback(
    async (segment: TimelineSegment, splitAtIso: string) => {
      const [left, right] = splitSegmentAt(segment, splitAtIso);
      if (!right) return;

      await persistAndRefresh(async (repo) => {
        await repo.updateSegment(left);
        await repo.insertSegment(right);
        if (activeSegment?.id === segment.id) setActiveSegment(right.endedAt === null ? right : left);
      });
    },
    [activeSegment, persistAndRefresh],
  );

  const mergeWithPrevious = useCallback(
    async (segment: TimelineSegment) => {
      const ordered = [...segments].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
      const index = ordered.findIndex((item) => item.id === segment.id);
      const previous = index > 0 ? ordered[index - 1] : null;
      if (!previous || !canMergeSegments(previous, segment)) return;

      await persistAndRefresh(async (repo) => {
        const merged = {
          ...previous,
          endedAt: segment.endedAt,
          updatedAt: new Date().toISOString(),
          isEdited: true,
        };
        await repo.updateSegment(merged);
        await repo.deleteSegment(segment.id);
        if (activeSegment?.id === segment.id) setActiveSegment(merged);
      });
    },
    [activeSegment, persistAndRefresh, segments],
  );

  const deleteSegment = useCallback(
    async (segment: TimelineSegment) => {
      if (activeSegment?.id === segment.id) return;
      await persistAndRefresh(async (repo) => {
        await repo.deleteSegment(segment.id);
      });
    },
    [activeSegment, persistAndRefresh],
  );

  return {
    loading,
    error,
    state,
    settings,
    taskDraft,
    setTaskDraft,
    segments,
    activeSegment,
    stats,
    snapshot,
    reminderVisible,
    startBusy,
    startRest,
    pause,
    resume,
    changeTask,
    extend,
    acknowledgeReminder,
    saveSettings,
    updateSegment,
    splitSegment,
    mergeWithPrevious,
    deleteSegment,
    refresh,
  };
}
