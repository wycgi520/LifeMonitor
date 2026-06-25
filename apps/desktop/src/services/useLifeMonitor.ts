import {
  DEFAULT_SETTINGS,
  addMinutes,
  calculateTodayStats,
  canMergeSegments,
  closeSegment,
  createManualSegment,
  createSegment,
  deriveTimerSnapshot,
  extendDueAt,
  getTargetMinutes,
  getLocalDayRange,
  mergeSegments,
  normalizeNote,
  normalizeTaskName,
  splitSegmentAt,
  type LifeSettings,
  type LifeState,
  type SummaryEntry,
  type SummaryScope,
  type TimelineSegment,
  type TodayStats,
  type TrackableState,
} from "@lifemonitor/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { showReminderNotification } from "./notifications";
import { registerWindowCloseBehavior, syncPlatformSettings } from "./platform";
import { createRepository, parseLifeDataExport, type LifeDataExport, type LifeRepository } from "./repository";

interface PausedContext {
  state: TrackableState;
  taskName: string | null;
  stateRunId: string;
  remainingMs: number;
}

interface ManualSegmentInput {
  state: TrackableState;
  taskName: string | null;
  note?: string | null;
  startedAt: string;
  endedAt: string;
}

interface TimeoutNotice {
  state: TrackableState;
  taskName: string | null;
  endedAt: string;
  runId: string;
  segment: TimelineSegment;
}

export interface LifeMonitorController {
  loading: boolean;
  error: string | null;
  state: LifeState;
  settings: LifeSettings;
  selectedDate: string;
  selectedWeekKey: string;
  isViewingToday: boolean;
  taskDraft: string;
  setTaskDraft: (value: string) => void;
  setSelectedDate: (value: string) => void;
  goToPreviousDay: () => void;
  goToNextDay: () => void;
  goToToday: () => void;
  segments: TimelineSegment[];
  activeSegment: TimelineSegment | null;
  daySummary: SummaryEntry | null;
  weekSummary: SummaryEntry | null;
  stats: TodayStats;
  snapshot: ReturnType<typeof deriveTimerSnapshot>;
  timeoutNotice: TimeoutNotice | null;
  startBusy: (taskName?: string | null) => Promise<void>;
  startRest: (taskName?: string | null) => Promise<void>;
  endCurrent: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  changeTask: (taskName: string | null) => Promise<void>;
  changeActiveNote: (note: string | null) => Promise<void>;
  extend: (minutes: number) => Promise<void>;
  extendTimeoutNoticeToNow: () => Promise<void>;
  dismissTimeoutNotice: () => void;
  saveSettings: (settings: LifeSettings) => Promise<void>;
  saveSummary: (scope: SummaryScope, content: string) => Promise<void>;
  addManualSegment: (input: ManualSegmentInput) => Promise<boolean>;
  updateSegment: (segment: TimelineSegment) => Promise<void>;
  splitSegment: (segment: TimelineSegment, splitAtIso: string) => Promise<void>;
  mergeWithPrevious: (segment: TimelineSegment) => Promise<void>;
  deleteSegment: (segment: TimelineSegment) => Promise<void>;
  exportData: () => Promise<LifeDataExport>;
  importData: (raw: string) => Promise<LifeDataExport>;
  refresh: () => Promise<void>;
}

export function useLifeMonitor(): LifeMonitorController {
  const [repository, setRepository] = useState<LifeRepository | null>(null);
  const [settings, setSettings] = useState<LifeSettings>(DEFAULT_SETTINGS);
  const [state, setState] = useState<LifeState>("idle");
  const [selectedDate, setSelectedDateState] = useState(() => toLocalDateKey(new Date()));
  const [taskDraft, setTaskDraftValue] = useState("");
  const [isTaskDraftUserEdited, setIsTaskDraftUserEdited] = useState(false);
  const [segments, setSegments] = useState<TimelineSegment[]>([]);
  const [activeSegment, setActiveSegment] = useState<TimelineSegment | null>(null);
  const [daySummary, setDaySummary] = useState<SummaryEntry | null>(null);
  const [weekSummary, setWeekSummary] = useState<SummaryEntry | null>(null);
  const [pausedContext, setPausedContext] = useState<PausedContext | null>(null);
  const [timeoutNotice, setTimeoutNotice] = useState<TimeoutNotice | null>(null);
  const [notifiedRunIds, setNotifiedRunIds] = useState<Set<string>>(() => new Set());
  const [extensionMinutesByRun, setExtensionMinutesByRun] = useState<Record<string, number>>({});
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);
  const lastTodayKey = useRef(toLocalDateKey(new Date()));
  const settlingRunIds = useRef<Set<string>>(new Set());
  const settingsRef = useRef<LifeSettings>(DEFAULT_SETTINGS);

  const selectedDayRange = useMemo(() => getDayRangeForDateKey(selectedDate), [selectedDate]);
  const selectedWeekKey = useMemo(() => getWeekKeyForDateKey(selectedDate), [selectedDate]);
  const todayKey = useMemo(() => toLocalDateKey(new Date(nowIso)), [nowIso]);
  const isViewingToday = selectedDate === todayKey;

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const setSelectedDate = useCallback((value: string) => {
    if (!isLocalDateKey(value)) return;
    setSelectedDateState(value);
  }, []);

  const goToPreviousDay = useCallback(() => {
    setSelectedDateState((current) => shiftLocalDateKey(current, -1));
  }, []);

  const goToNextDay = useCallback(() => {
    setSelectedDateState((current) => {
      const next = shiftLocalDateKey(current, 1);
      return next > toLocalDateKey(new Date()) ? current : next;
    });
  }, []);

  const goToToday = useCallback(() => {
    setSelectedDateState(toLocalDateKey(new Date()));
  }, []);

  const setTaskDraft = useCallback((value: string) => {
    setTaskDraftValue(value);
    setIsTaskDraftUserEdited(true);
  }, []);

  const setTaskDraftFromSystem = useCallback((value: string) => {
    setTaskDraftValue(value);
    setIsTaskDraftUserEdited(false);
  }, []);

  const refresh = useCallback(async () => {
    if (!repository) return;
    setSegments(await repository.listSegments(selectedDayRange.startIso, selectedDayRange.endIso));
  }, [repository, selectedDayRange.endIso, selectedDayRange.startIso]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const init = async () => {
      try {
        const nextRepository = await createRepository();
        const nextSettings = await nextRepository.loadSettings();
        const openSegment = await nextRepository.getOpenSegment();

        setRepository(nextRepository);
        settingsRef.current = nextSettings;
        setSettings(nextSettings);
        setActiveSegment(openSegment);
        setState(openSegment?.state ?? "idle");
        setTaskDraftFromSystem(openSegment?.taskName ?? "");
        setSegments(await nextRepository.listSegments(selectedDayRange.startIso, selectedDayRange.endIso));
        await syncPlatformSettings(nextSettings);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setLoading(false);
      }
    };

    void init();
  }, [selectedDayRange.endIso, selectedDayRange.startIso, setTaskDraftFromSystem]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowIso(new Date().toISOString());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const nextTodayKey = toLocalDateKey(new Date(nowIso));
    const previousTodayKey = lastTodayKey.current;
    if (nextTodayKey === previousTodayKey) return;

    lastTodayKey.current = nextTodayKey;
    setSelectedDateState((current) => (current === previousTodayKey ? nextTodayKey : current));
  }, [nowIso]);

  useEffect(() => {
    if (!repository) return;

    let disposed = false;
    void repository
      .listSegments(selectedDayRange.startIso, selectedDayRange.endIso)
      .then((nextSegments) => {
        if (disposed) return;
        setSegments(nextSegments);
        setError(null);
      })
      .catch((caught) => {
        if (!disposed) setError(caught instanceof Error ? caught.message : String(caught));
      });

    return () => {
      disposed = true;
    };
  }, [repository, selectedDayRange.endIso, selectedDayRange.startIso]);

  useEffect(() => {
    if (!repository) return;

    let disposed = false;
    void Promise.all([repository.loadSummary("day", selectedDate), repository.loadSummary("week", selectedWeekKey)])
      .then(([nextDaySummary, nextWeekSummary]) => {
        if (disposed) return;
        setDaySummary(nextDaySummary);
        setWeekSummary(nextWeekSummary);
        setError(null);
      })
      .catch((caught) => {
        if (!disposed) setError(caught instanceof Error ? caught.message : String(caught));
      });

    return () => {
      disposed = true;
    };
  }, [repository, selectedDate, selectedWeekKey]);

  useEffect(() => {
    if (!repository) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    const saveCloseBehavior = async (nextSettings: LifeSettings) => {
      await repository.saveSettings(nextSettings);
      settingsRef.current = nextSettings;
      setSettings(nextSettings);
    };

    void registerWindowCloseBehavior(settings, saveCloseBehavior).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
        return;
      }

      unlisten = nextUnlisten;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [repository, settings]);

  const stats = useMemo(() => {
    return calculateTodayStats(segments, selectedDayRange.startIso, selectedDayRange.endIso, nowIso);
  }, [nowIso, segments, selectedDayRange.endIso, selectedDayRange.startIso]);

  const snapshotSegment = useMemo(() => {
    if (!activeSegment) return null;

    const runStartedAt = [...segments, activeSegment]
      .filter((segment) => segment.stateRunId === activeSegment.stateRunId)
      .reduce(
        (earliest, segment) => (segment.startedAt < earliest ? segment.startedAt : earliest),
        activeSegment.startedAt,
      );

    return runStartedAt === activeSegment.startedAt
      ? activeSegment
      : {
          ...activeSegment,
          startedAt: runStartedAt,
        };
  }, [activeSegment, segments]);

  const snapshot = useMemo(
    () =>
      deriveTimerSnapshot({
        state,
        activeSegment: snapshotSegment,
        settings,
        nowIso,
        extensionMinutes: activeSegment ? extensionMinutesByRun[activeSegment.stateRunId] ?? 0 : 0,
      }),
    [activeSegment, extensionMinutesByRun, nowIso, settings, snapshotSegment, state],
  );

  const persistAndRefresh = useCallback(
    async (operation: (repo: LifeRepository) => Promise<void>) => {
      if (!repository) return;
      try {
        await operation(repository);
        setSegments(await repository.listSegments(selectedDayRange.startIso, selectedDayRange.endIso));
        setError(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    },
    [repository, selectedDayRange.endIso, selectedDayRange.startIso],
  );

  useEffect(() => {
    if (!repository || !activeSegment || state === "idle" || state === "paused" || !snapshot.isDue) return;

    const runId = activeSegment.stateRunId;
    if (settlingRunIds.current.has(runId)) return;
    settlingRunIds.current.add(runId);

    const dueAt = activeSegment.plannedEndAt;
    const dueSnapshot = snapshot;

    void (async () => {
      try {
        if (!notifiedRunIds.has(runId)) {
          setNotifiedRunIds((previous) => new Set(previous).add(runId));
          void showReminderNotification(dueSnapshot, settings).catch((caught) => {
            console.warn("Failed to show timeout notification.", caught);
          });
        }

        await persistAndRefresh(async (repo) => {
          const closed = closeSegment(activeSegment, dueAt);
          await repo.updateSegment(closed);
          setActiveSegment(null);
          setState("idle");
          setTaskDraftFromSystem("");
          setPausedContext(null);
          setTimeoutNotice({
            state: activeSegment.state,
            taskName: activeSegment.taskName,
            endedAt: dueAt,
            runId,
            segment: closed,
          });
          setExtensionMinutesByRun((previous) => {
            const next = { ...previous };
            delete next[runId];
            return next;
          });
        });
      } finally {
        settlingRunIds.current.delete(runId);
      }
    })();
  }, [activeSegment, notifiedRunIds, persistAndRefresh, repository, setTaskDraftFromSystem, settings, snapshot, state]);

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
      const isContinuingState = activeSegment?.state === nextState;

      await persistAndRefresh(async (repo) => {
        if (timeoutNotice && !activeSegment) {
          await repo.updateSegment({
            ...timeoutNotice.segment,
            endedAt: now,
            updatedAt: now,
            isEdited: true,
          });
          setTimeoutNotice(null);
        }
        await closeCurrent(repo, now);
        const draftTask = taskName === undefined && !isTaskDraftUserEdited ? null : normalizeTaskName(taskName ?? taskDraft);
        const normalizedTask = draftTask ?? (await repo.getLatestTaskName(nextState));
        const nextSegment = createSegment({
          state: nextState,
          taskName: normalizedTask,
          nowIso: now,
          settings: settingsRef.current,
          stateRunId: isContinuingState ? activeSegment.stateRunId : undefined,
          plannedEndAt: isContinuingState ? activeSegment.plannedEndAt : undefined,
        });
        await repo.insertSegment(nextSegment);
        setActiveSegment(nextSegment);
        setState(nextState);
        setTaskDraftFromSystem(nextSegment.taskName ?? "");
        setPausedContext(null);
        setTimeoutNotice(null);
      });
    },
    [
      activeSegment,
      closeCurrent,
      isTaskDraftUserEdited,
      persistAndRefresh,
      setTaskDraftFromSystem,
      taskDraft,
      timeoutNotice,
    ],
  );

  const startBusy = useCallback(
    (taskName?: string | null) => switchToState("busy", taskName),
    [switchToState],
  );

  const startRest = useCallback(
    (taskName?: string | null) => switchToState("rest", taskName),
    [switchToState],
  );

  const endCurrent = useCallback(async () => {
    if (state === "paused") {
      setActiveSegment(null);
      setPausedContext(null);
      setState("idle");
      setTaskDraftFromSystem("");
      setTimeoutNotice(null);
      return;
    }

    if (!activeSegment) return;

    const now = new Date().toISOString();
    const runId = activeSegment.stateRunId;
    await persistAndRefresh(async (repo) => {
      await closeCurrent(repo, now);
      setActiveSegment(null);
      setState("idle");
      setTaskDraftFromSystem("");
      setPausedContext(null);
      setTimeoutNotice(null);
      setExtensionMinutesByRun((previous) => {
        const next = { ...previous };
        delete next[runId];
        return next;
      });
    });
  }, [activeSegment, closeCurrent, persistAndRefresh, setTaskDraftFromSystem, state]);

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
      setTimeoutNotice(null);
    });
  }, [activeSegment, closeCurrent, persistAndRefresh]);

  const resume = useCallback(async () => {
    if (!pausedContext) {
      await switchToState("busy");
      return;
    }

    const now = new Date().toISOString();
    const plannedEndAt = new Date(new Date(now).getTime() + pausedContext.remainingMs).toISOString();

    await persistAndRefresh(async (repo) => {
      const nextSegment = createSegment({
        state: pausedContext.state,
        taskName: pausedContext.taskName,
        nowIso: now,
        settings: settingsRef.current,
        stateRunId: pausedContext.stateRunId,
        plannedEndAt,
      });
      await repo.insertSegment(nextSegment);
      setActiveSegment(nextSegment);
      setState(pausedContext.state);
      setTaskDraftFromSystem(nextSegment.taskName ?? "");
      setPausedContext(null);
      setTimeoutNotice(null);
    });
  }, [pausedContext, persistAndRefresh, setTaskDraftFromSystem, switchToState]);

  const changeTask = useCallback(
    async (taskName: string | null) => {
      const normalizedTask = normalizeTaskName(taskName);
      if (!activeSegment) {
        setTaskDraft(normalizedTask ?? "");
        return;
      }

      setTaskDraftFromSystem(normalizedTask ?? "");

      const now = new Date().toISOString();
      await persistAndRefresh(async (repo) => {
        await closeCurrent(repo, now);
        const nextSegment = createSegment({
          state: activeSegment.state,
          taskName: normalizedTask,
          nowIso: now,
          settings: settingsRef.current,
          stateRunId: activeSegment.stateRunId,
          plannedEndAt: activeSegment.plannedEndAt,
        });
        await repo.insertSegment(nextSegment);
        setActiveSegment(nextSegment);
      });
    },
    [activeSegment, closeCurrent, persistAndRefresh, setTaskDraft, setTaskDraftFromSystem],
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
      });
    },
    [activeSegment, persistAndRefresh],
  );

  const dismissTimeoutNotice = useCallback(() => {
    setTimeoutNotice(null);
  }, []);

  const extendTimeoutNoticeToNow = useCallback(async () => {
    if (!timeoutNotice || activeSegment) return;

    const now = new Date().toISOString();
    if (new Date(now).getTime() <= new Date(timeoutNotice.endedAt).getTime()) {
      setTimeoutNotice(null);
      return;
    }

    await persistAndRefresh(async (repo) => {
      const updatedSegment = {
        ...timeoutNotice.segment,
        endedAt: now,
        updatedAt: now,
        isEdited: true,
      };

      await repo.updateSegment(updatedSegment);
      setTimeoutNotice(null);
    });
  }, [activeSegment, persistAndRefresh, timeoutNotice]);

  const saveSettings = useCallback(
    async (nextSettings: LifeSettings) => {
      await persistAndRefresh(async (repo) => {
        const previousSettings = settingsRef.current;
        const activeRunExtensionMinutes = activeSegment
          ? getRunExtensionMinutes(
              activeSegment,
              segments,
              previousSettings,
              extensionMinutesByRun[activeSegment.stateRunId] ?? 0,
            )
          : 0;

        await repo.saveSettings(nextSettings);
        settingsRef.current = nextSettings;
        setSettings(nextSettings);
        if (activeSegment) {
          const updatedAt = new Date().toISOString();
          const plannedEndAt = getRunPlannedEndAt(
            activeSegment,
            segments,
            nextSettings,
            activeRunExtensionMinutes,
          );

          await repo.updateRunPlannedEnd(activeSegment.stateRunId, plannedEndAt, updatedAt);
          setActiveSegment({
            ...activeSegment,
            plannedEndAt,
            updatedAt,
          });
        }
        await syncPlatformSettings(nextSettings);
      });
    },
    [activeSegment, extensionMinutesByRun, persistAndRefresh, segments],
  );

  const addManualSegment = useCallback(
    async (input: ManualSegmentInput): Promise<boolean> => {
      if (!repository) return false;

      try {
        const segment = createManualSegment({
          ...input,
          settings: settingsRef.current,
        });
        const overlappingSegments = await repository.listSegments(segment.startedAt, input.endedAt);
        if (overlappingSegments.length > 0) {
          throw new Error("补记时间和已有记录重叠，请先调整现有记录。");
        }

        await repository.insertSegment(segment);
        setSegments(await repository.listSegments(selectedDayRange.startIso, selectedDayRange.endIso));
        setError(null);
        return true;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        return false;
      }
    },
    [repository, selectedDayRange.endIso, selectedDayRange.startIso],
  );

  const updateSegment = useCallback(
    async (segment: TimelineSegment) => {
      const updated = {
        ...segment,
        taskName: normalizeTaskName(segment.taskName),
        note: normalizeNote(segment.note),
        updatedAt: new Date().toISOString(),
        isEdited: true,
      };
      const startMs = new Date(updated.startedAt).getTime();
      const endMs = updated.endedAt === null ? null : new Date(updated.endedAt).getTime();

      if (!Number.isFinite(startMs) || (endMs !== null && (!Number.isFinite(endMs) || endMs <= startMs))) {
        setError("结束时间需要晚于开始时间。");
        return;
      }

      if (updated.endedAt === null && activeSegment?.id !== updated.id) {
        setError("只有进行中的记录可以没有结束时间。");
        return;
      }

      await persistAndRefresh(async (repo) => {
        const overlapEnd = updated.endedAt ?? new Date().toISOString();
        const overlappingSegments = await repo.listSegments(updated.startedAt, overlapEnd);
        if (overlappingSegments.some((item) => item.id !== updated.id)) {
          throw new Error("调整后的时间和已有记录重叠，请先调整相邻记录。");
        }

        await repo.updateSegment(updated);
        if (activeSegment?.id === updated.id) {
          setActiveSegment(updated);
          setState(updated.state);
          setTaskDraftFromSystem(updated.taskName ?? "");
        }
      });
    },
    [activeSegment, persistAndRefresh, setTaskDraftFromSystem],
  );

  const changeActiveNote = useCallback(
    async (note: string | null) => {
      if (!activeSegment) return;
      const now = new Date().toISOString();
      const updated = {
        ...activeSegment,
        note: normalizeNote(note),
        updatedAt: now,
        isEdited: true,
      };

      await persistAndRefresh(async (repo) => {
        await repo.updateSegment(updated);
        setActiveSegment(updated);
      });
    },
    [activeSegment, persistAndRefresh],
  );

  const saveSummary = useCallback(
    async (scope: SummaryScope, content: string) => {
      if (!repository) return;

      const summary: SummaryEntry = {
        scope,
        key: scope === "day" ? selectedDate : selectedWeekKey,
        content: content.trim(),
        updatedAt: new Date().toISOString(),
      };

      try {
        await repository.saveSummary(summary);
        if (scope === "day") {
          setDaySummary(summary);
        } else {
          setWeekSummary(summary);
        }
        setError(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    },
    [repository, selectedDate, selectedWeekKey],
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
        const merged = mergeSegments(previous, segment);
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

  const exportData = useCallback(async (): Promise<LifeDataExport> => {
    if (!repository) throw new Error("记录仓库还没有准备好。");

    try {
      const data = await repository.exportData();
      setError(null);
      return data;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      throw caught;
    }
  }, [repository]);

  const importData = useCallback(
    async (raw: string): Promise<LifeDataExport> => {
      if (!repository) throw new Error("记录仓库还没有准备好。");

      try {
        const data = parseLifeDataExport(raw);
        await repository.replaceData(data);
        const nextSettings = await repository.loadSettings();
        const openSegment = await repository.getOpenSegment();

        settingsRef.current = nextSettings;
        setSettings(nextSettings);
        setActiveSegment(openSegment);
        setState(openSegment?.state ?? "idle");
        setTaskDraftFromSystem(openSegment?.taskName ?? "");
        setPausedContext(null);
        setTimeoutNotice(null);
        setNotifiedRunIds(new Set());
        setExtensionMinutesByRun({});
        settlingRunIds.current.clear();
        setSegments(await repository.listSegments(selectedDayRange.startIso, selectedDayRange.endIso));
        setDaySummary(await repository.loadSummary("day", selectedDate));
        setWeekSummary(await repository.loadSummary("week", selectedWeekKey));
        await syncPlatformSettings(nextSettings);
        setError(null);
        return data;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        throw caught;
      }
    },
    [
      repository,
      selectedDate,
      selectedDayRange.endIso,
      selectedDayRange.startIso,
      selectedWeekKey,
      setTaskDraftFromSystem,
    ],
  );

  return {
    loading,
    error,
    state,
    settings,
    selectedDate,
    selectedWeekKey,
    isViewingToday,
    taskDraft,
    setTaskDraft,
    setSelectedDate,
    goToPreviousDay,
    goToNextDay,
    goToToday,
    segments,
    activeSegment,
    daySummary,
    weekSummary,
    stats,
    snapshot,
    timeoutNotice,
    startBusy,
    startRest,
    endCurrent,
    pause,
    resume,
    changeTask,
    changeActiveNote,
    extend,
    extendTimeoutNoticeToNow,
    dismissTimeoutNotice,
    saveSettings,
    saveSummary,
    addManualSegment,
    updateSegment,
    splitSegment,
    mergeWithPrevious,
    deleteSegment,
    exportData,
    importData,
    refresh,
  };
}

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isLocalDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dateFromLocalDateKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function getDayRangeForDateKey(value: string): { startIso: string; endIso: string } {
  return getLocalDayRange(dateFromLocalDateKey(value));
}

function shiftLocalDateKey(value: string, days: number): string {
  const date = dateFromLocalDateKey(value);
  date.setDate(date.getDate() + days);
  return toLocalDateKey(date);
}

function getWeekKeyForDateKey(value: string): string {
  const date = dateFromLocalDateKey(value);
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + mondayOffset);
  return toLocalDateKey(date);
}

function getRunPlannedEndAt(
  activeSegment: TimelineSegment,
  segments: TimelineSegment[],
  settings: LifeSettings,
  extensionMinutes: number,
): string {
  const runStartedAt = getRunStartedAt(activeSegment, segments);
  return addMinutes(runStartedAt, getTargetMinutes(activeSegment.state, settings) + extensionMinutes);
}

function getRunStartedAt(activeSegment: TimelineSegment, segments: TimelineSegment[]): string {
  return [...segments, activeSegment]
    .filter((segment) => segment.stateRunId === activeSegment.stateRunId)
    .reduce(
      (earliest, segment) => (segment.startedAt < earliest ? segment.startedAt : earliest),
      activeSegment.startedAt,
    );
}

function getRunExtensionMinutes(
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
