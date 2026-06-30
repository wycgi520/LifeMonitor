import {
  BarChart3,
  BellRing,
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Check,
  Clock3,
  Coffee,
  Download,
  Grip,
  ListTree,
  Maximize2,
  Merge,
  Minimize2,
  Pause,
  Pencil,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Save,
  Scissors,
  Settings2,
  Square,
  Trash2,
  Upload,
  Volume2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  DEFAULT_SETTINGS,
  UNMARKED_TASK,
  canMergeSegments,
  formatDuration,
  normalizeTaskName,
  type CloseWindowBehavior,
  type LifeSettings,
  type RhythmDeviationDirection,
  type TimelineSegment,
  type TrackableState,
} from "@lifemonitor/core";
import "./App.css";
import {
  DAY_MINUTES,
  RULER_STEP_MINUTES,
  clamp,
  clampMinutes,
  durationFor,
  floorMinuteToStep,
  formatDateLabel,
  formatDateTimeLabel,
  formatHourMark,
  formatMiniDuration,
  formatMinuteLabel,
  formatRulerZoomLabel,
  getLocalMinuteOfDay,
  hasTimelineDraftChanges,
  isIsoOnLocalDate,
  isPersistableTimelineDraft,
  isoFromLocalMinute,
  isoFromLocalTimeInput,
  localDateFromKey,
  maybeFromLocalInputValue,
  midpointIso,
  minuteFromTimeInput,
  normalizeTimelineDraft,
  segmentOvertimeSeconds,
  segmentUndertimeSeconds,
  snapMinute,
  timeInputValueFromIso,
  timeInputValueFromMinute,
  toDateInputValue,
  toLocalInputValue,
  toRulerPercent,
} from "./lib/time";
import { DayRuler, DonutChart, Metric, StateFeedback, TargetRing, TaskStatsList } from "./components/metrics";
import { getTimeDistributionSegments } from "./components/metrics-data";
import { isTauriRuntime } from "./services/repository";
import { useLifeMonitor } from "./services/useLifeMonitor";
import {
  registerMiniWindowPositionTracking,
  startWindowDrag,
  startWindowResize,
  syncAlwaysOnTopSetting,
  syncWindowMode,
  type AppWindowMode,
} from "./services/platform";

const WINDOW_MODE_STORAGE_KEY = "lifemonitor:window-mode:v1";
const DEFAULT_BACKFILL_MINUTES = 30;
const RULER_BASE_WIDTH_PX = 760;
const RULER_ZOOM_LEVELS = [1, 1.5, 2.5, 4] as const;

type PageId = "today" | "timeline" | "stats" | "settings";
type MonitorController = ReturnType<typeof useLifeMonitor>;
type BackfillDragMode = "start" | "end" | "range";

const stateLabels = {
  idle: "空闲",
  busy: "忙碌",
  rest: "休息",
  paused: "暂停",
};

const miniStateLabels = {
  idle: "闲",
  busy: "忙",
  rest: "休",
  paused: "停",
};

const trackableStateLabels: Record<TrackableState, string> = {
  busy: "忙碌",
  rest: "休息",
};

const pageItems = [
  { id: "today", label: "今日", Icon: BriefcaseBusiness },
  { id: "timeline", label: "时间线", Icon: ListTree },
  { id: "stats", label: "统计", Icon: BarChart3 },
  { id: "settings", label: "设置", Icon: Settings2 },
] as const;

function App() {
  const monitor = useLifeMonitor();
  const [settingsDraft, setSettingsDraft] = useState<LifeSettings>(DEFAULT_SETTINGS);
  const [windowMode, setWindowMode] = useState<AppWindowMode>(() => readWindowMode());
  const [activePage, setActivePage] = useState<PageId>("today");
  const importInputRef = useRef<HTMLInputElement>(null);
  const alwaysOnTopRef = useRef(monitor.settings.alwaysOnTop);
  const [dataTransferMessage, setDataTransferMessage] = useState<string | null>(null);

  useEffect(() => {
    setSettingsDraft(monitor.settings);
  }, [monitor.settings]);

  useEffect(() => {
    alwaysOnTopRef.current = monitor.settings.alwaysOnTop;
  }, [monitor.settings.alwaysOnTop]);

  useEffect(() => {
    if (monitor.loading) return;
    void syncAlwaysOnTopSetting(monitor.settings.alwaysOnTop);
  }, [monitor.loading, monitor.settings.alwaysOnTop]);

  useEffect(() => {
    window.localStorage.setItem(WINDOW_MODE_STORAGE_KEY, windowMode);

    const syncWindowModeAndTopmost = async () => {
      await syncWindowMode(windowMode);
      // Window style changes can reset the topmost flag on Windows.
      await syncAlwaysOnTopSetting(alwaysOnTopRef.current);
    };

    void syncWindowModeAndTopmost();
  }, [windowMode]);

  useEffect(() => {
    document.documentElement.classList.toggle("mini-window-root", windowMode === "mini");

    return () => {
      document.documentElement.classList.remove("mini-window-root");
    };
  }, [windowMode]);

  const chronologicalSegments = useMemo(
    () => [...monitor.segments].sort((left, right) => left.startedAt.localeCompare(right.startedAt)),
    [monitor.segments],
  );
  const timelineSegments = useMemo(() => [...chronologicalSegments].reverse(), [chronologicalSegments]);
  const selectedDateLabel = useMemo(
    () => formatDateLabel(monitor.selectedDate, monitor.isViewingToday),
    [monitor.isViewingToday, monitor.selectedDate],
  );

  const statusTone = monitor.snapshot.isDue ? "is-due" : monitor.state;
  const showDateControls = activePage === "timeline" || activePage === "stats";

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    await monitor.saveSettings({
      ...settingsDraft,
      busyMinutes: clampMinutes(settingsDraft.busyMinutes, 1, 240),
      restMinutes: clampMinutes(settingsDraft.restMinutes, 1, 120),
      quickTasks: settingsDraft.quickTasks.map((task) => task.trim()).filter(Boolean),
    });
  };

  const updateAlwaysOnTop = (alwaysOnTop: boolean) => {
    alwaysOnTopRef.current = alwaysOnTop;
    setSettingsDraft((current) => ({ ...current, alwaysOnTop }));
    void syncAlwaysOnTopSetting(alwaysOnTop);
  };

  const openPage = (page: PageId) => {
    setActivePage(page);
    if (page === "today") monitor.goToToday();
  };

  const exportRecords = async () => {
    try {
      const data = await monitor.exportData();
      const fileName = `lifemonitor-${toDateInputValue(new Date())}.json`;
      const exportLocation = await saveJsonExport(data, fileName);
      setDataTransferMessage(`已导出 ${data.segments.length} 条记录、${data.summaries.length} 条总结到：${exportLocation}`);
    } catch (caught) {
      setDataTransferMessage(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const requestImportRecords = () => {
    importInputRef.current?.click();
  };

  const importRecords = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!window.confirm("导入会覆盖本机现有记录和设置，确定继续吗？")) return;

    try {
      const data = await monitor.importData(await file.text());
      setDataTransferMessage(`已导入 ${data.segments.length} 条记录、${data.summaries.length} 条总结。`);
      setActivePage("timeline");
    } catch (caught) {
      setDataTransferMessage(caught instanceof Error ? caught.message : String(caught));
    }
  };

  if (monitor.loading) {
    return (
      <main className="app-shell loading-shell">
        <Clock3 aria-hidden="true" />
        <p>正在加载 LifeMonitor</p>
      </main>
    );
  }

  if (windowMode === "mini") {
    return <MiniReminderWindow monitor={monitor} statusTone={statusTone} onExpand={() => setWindowMode("full")} />;
  }

  return (
    <main className="app-shell">
      {monitor.timeoutNotice && (
        <TimeoutNoticeBanner
          monitor={monitor}
          onOpenTimeline={() => {
            setActivePage("timeline");
          }}
        />
      )}

      <header className="topbar">
        <nav className="page-tabs" aria-label="主页面">
          {pageItems.map((item) => {
            const Icon = item.Icon;
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`page-tab ${isActive ? "active" : ""}`}
                aria-current={isActive ? "page" : undefined}
                onClick={() => openPage(item.id)}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="topbar-actions">
          {showDateControls && <DateControls monitor={monitor} />}
          <button type="button" className="icon-only" onClick={() => setWindowMode("mini")} title="切换到迷你提醒窗">
            <Minimize2 aria-hidden="true" />
          </button>
          <div className={`status-pill ${statusTone}`}>
            <BellRing aria-hidden="true" />
            <span>{getStatusLabel(monitor)}</span>
          </div>
        </div>
      </header>

      {monitor.error && <p className="error-line">{monitor.error}</p>}

      <div className="page-content">
        {activePage === "today" && <TodayPage monitor={monitor} />}
        {activePage === "timeline" && (
          <TimelinePage
            monitor={monitor}
            chronologicalSegments={chronologicalSegments}
            timelineSegments={timelineSegments}
            selectedDateLabel={selectedDateLabel}
          />
        )}
        {activePage === "stats" && <StatsPage monitor={monitor} selectedDateLabel={selectedDateLabel} />}
        {activePage === "settings" && (
          <SettingsPage
            settingsDraft={settingsDraft}
            setSettingsDraft={setSettingsDraft}
            onAlwaysOnTopChange={updateAlwaysOnTop}
            onSubmit={saveSettings}
            onExportData={() => void exportRecords()}
            onRequestImport={requestImportRecords}
            importInputRef={importInputRef}
            onImportFile={(event) => void importRecords(event)}
            dataTransferMessage={dataTransferMessage}
          />
        )}
      </div>
    </main>
  );
}

function TimeoutNoticeBanner({
  monitor,
  onOpenTimeline,
}: {
  monitor: MonitorController;
  onOpenTimeline: () => void;
}) {
  const notice = monitor.timeoutNotice;
  if (!notice) return null;

  return (
    <section className="reminder" aria-live="polite">
      <div className="reminder-copy">
        <p className="eyebrow">到点提醒</p>
        <p className="reminder-status">
          <strong>已自动回到空闲</strong>，{trackableStateLabels[notice.state]}已在{" "}
          {formatDateTimeLabel(notice.endedAt)} 结束。
        </p>
        <p className="muted">上一段：{notice.taskName ?? UNMARKED_TASK}</p>
      </div>
      <div className="reminder-actions">
        <button
          type="button"
          className={`icon-button extend-to-now ${notice.state}`}
          onClick={() => void monitor.extendTimeoutNoticeToNow()}
          title="把刚刚结束的状态补到现在"
        >
          <Clock3 aria-hidden="true" />
          <span>补到现在</span>
        </button>
        <button type="button" className="icon-button primary" onClick={() => void monitor.startBusy()} title="从现在开始忙碌">
          <BriefcaseBusiness aria-hidden="true" />
          <span>从现在忙碌</span>
        </button>
        <button type="button" className="icon-button rest" onClick={() => void monitor.startRest()} title="从现在开始休息">
          <Coffee aria-hidden="true" />
          <span>从现在休息</span>
        </button>
        <button type="button" className="icon-button" onClick={onOpenTimeline} title="打开时间线补记">
          <ListTree aria-hidden="true" />
          <span>补记/调整</span>
        </button>
        <button type="button" className="icon-button" onClick={monitor.dismissTimeoutNotice} title="收起提醒">
          <Check aria-hidden="true" />
          <span>知道了</span>
        </button>
      </div>
    </section>
  );
}

function DateControls({ monitor }: { monitor: MonitorController }) {
  return (
    <div className="date-controls" aria-label="查看记录日期">
      <button type="button" className="icon-only" onClick={monitor.goToPreviousDay} title="前一天">
        <ChevronLeft aria-hidden="true" />
      </button>
      <label className="date-picker" title="选择日期">
        <CalendarDays aria-hidden="true" />
        <input
          type="date"
          value={monitor.selectedDate}
          max={toDateInputValue(new Date())}
          onChange={(event) => monitor.setSelectedDate(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="icon-only"
        onClick={monitor.goToNextDay}
        disabled={monitor.isViewingToday}
        title="后一天"
      >
        <ChevronRight aria-hidden="true" />
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={monitor.goToToday}
        disabled={monitor.isViewingToday}
        title="回到今天"
      >
        <CalendarDays aria-hidden="true" />
        <span>今天</span>
      </button>
    </div>
  );
}

function describeRhythm(direction: RhythmDeviationDirection, seconds: number) {
  const minutes = Math.round(seconds / 60);
  const span = minutes >= 1 ? `${minutes} 分钟` : "不到 1 分钟";

  if (direction === "needs-rest") {
    return {
      tone: "warning" as const,
      metricValue: "偏忙",
      detail: `少休息 ${span}`,
      feedbackTitle: "偏忙:该安排休息了",
      feedbackBody: `为了回到目标忙休比例,还差约 ${span} 休息。`,
    };
  }

  if (direction === "needs-busy") {
    return {
      tone: "warning" as const,
      metricValue: "偏休息",
      detail: `少忙碌 ${span}`,
      feedbackTitle: "偏休息:可以投入忙碌了",
      feedbackBody: `为了回到目标忙休比例,还差约 ${span} 忙碌。`,
    };
  }

  return {
    tone: undefined,
    metricValue: "平衡",
    detail: "忙休比例符合目标",
    feedbackTitle: "节奏平衡",
    feedbackBody: "忙碌和休息的比例符合目标,继续保持。",
  };
}

function TodayPage({ monitor }: { monitor: MonitorController }) {
  const distribution = getTimeDistributionSegments(monitor.stats);
  const rhythm = describeRhythm(
    monitor.stats.rhythmDeviationDirection,
    monitor.stats.rhythmDeviationSeconds,
  );

  return (
    <section className="today-layout">
      <div className="today-col-left">
        <FocusConsole monitor={monitor} />
        <FocusActivity monitor={monitor} />
      </div>
      <div className="today-col-right">
        <section className="stats-panel today-summary" aria-label="今日概览">
        <div className="summary-head">
          <h2>今日概览</h2>
          <span className="summary-head-note">现在该注意什么</span>
        </div>
        <div className="summary-columns">
          <div className="summary-col-data">
            <div className="summary-strip">
              <Metric label="番茄钟" value={`${monitor.stats.pomodoroCount} 个`} />
              <Metric label="节奏" value={rhythm.metricValue} tone={rhythm.tone} hint={rhythm.detail} />
              <Metric label="待补记忙碌" value={formatDuration(monitor.stats.unmarkedSeconds)} />
            </div>
            <DayRuler segments={distribution} />
            <StateFeedback tone={rhythm.tone === "warning" ? "warning" : "success"} title={rhythm.feedbackTitle}>
              {rhythm.feedbackBody}
            </StateFeedback>
          </div>
          <div className="summary-col-tasks">
            <p className="summary-col-title">今日忙碌内容</p>
            <TaskStatsList tasks={monitor.stats.taskStats.slice(0, 6)} emptyText="今天还没有忙碌记录" showBars />
          </div>
        </div>
        </section>
      </div>
    </section>
  );
}

function FocusConsole({ monitor }: { monitor: MonitorController }) {
  const timerStatusText = getFocusTimerStatus(monitor);
  const isRunning = monitor.state === "busy" || monitor.state === "rest";
  const targetSeconds = Math.max(1, monitor.snapshot.targetMinutes * 60);
  const progressRatio = isRunning ? monitor.snapshot.elapsedSeconds / targetSeconds : 0;
  const consoleTone = monitor.snapshot.isDue ? "is-due" : monitor.state;

  return (
    <div className={`focus-console ${consoleTone}`}>
      <TargetRing ratio={progressRatio} />
      <div className="focus-console-copy">
        <p className="focus-console-state">
          <span className="focus-state-name">{stateLabels[monitor.state]}</span>
          <span className="focus-state-status">{timerStatusText}</span>
        </p>
        <div className="focus-timer">{getFocusTimerDisplay(monitor)}</div>
        <p className="focus-console-meta">
          目标 {monitor.snapshot.targetMinutes} 分钟 · 已持续 {formatDuration(monitor.snapshot.elapsedSeconds)} ·{" "}
          {monitor.snapshot.taskName ?? UNMARKED_TASK}
        </p>
      </div>
    </div>
  );
}

function FocusActivity({ monitor }: { monitor: MonitorController }) {
  const canExtend = monitor.state === "busy" || monitor.state === "rest";
  const canEnd = monitor.state === "busy" || monitor.state === "rest" || monitor.state === "paused";

  return (
    <section className="focus-panel focus-record">
      <div className="focus-activity">
        <div className="task-form">
            <label htmlFor="task-input" className="activity-label">活动内容</label>
            <input
              id="task-input"
              className="activity-input"
              value={monitor.taskDraft}
              placeholder="工作 / 散步 / 喝水"
              onChange={(event) => monitor.setTaskDraft(event.target.value)}
            />
            {monitor.settings.quickTasks.length > 0 && (
              <div className="quick-tasks">
                {monitor.settings.quickTasks.map((task) => (
                  <button
                    key={task}
                    type="button"
                    className={monitor.taskDraft.trim() === task.trim() ? "active" : ""}
                    onClick={() => monitor.setTaskDraft(task)}
                  >
                    {task}
                  </button>
                ))}
              </div>
            )}
          </div>
          <ActiveNoteEditor monitor={monitor} />
        </div>

      <div className="action-bar">
        <button type="button" className="icon-button primary action-lead" onClick={() => void monitor.startBusy()}>
          <Play aria-hidden="true" />
          <span>开始忙碌</span>
        </button>
        <button type="button" className="icon-button rest action-lead" onClick={() => void monitor.startRest()}>
          <Coffee aria-hidden="true" />
          <span>开始休息</span>
        </button>
        <button type="button" className="icon-button danger" disabled={!canEnd} onClick={() => void monitor.endCurrent()}>
          <Square aria-hidden="true" />
          <span>结束</span>
        </button>
        {monitor.state === "paused" ? (
          <button type="button" className="icon-button" onClick={() => void monitor.resume()}>
            <Play aria-hidden="true" />
            <span>继续</span>
          </button>
        ) : (
          <button type="button" className="icon-button" disabled={!canEnd} onClick={() => void monitor.pause()}>
            <Pause aria-hidden="true" />
            <span>暂停</span>
          </button>
        )}
        <button type="button" className="icon-button action-mini" disabled={!canExtend} onClick={() => void monitor.extend(5)} title="延长 5 分钟">
          <Clock3 aria-hidden="true" />
          <span>+5 分</span>
        </button>
        <button type="button" className="icon-button action-mini" disabled={!canExtend} onClick={() => void monitor.extend(10)} title="延长 10 分钟">
          <Clock3 aria-hidden="true" />
          <span>+10 分</span>
        </button>
      </div>
    </section>
  );
}

function ActiveNoteEditor({ monitor }: { monitor: MonitorController }) {
  const [note, setNote] = useState(monitor.activeSegment?.note ?? "");
  const canEdit = Boolean(monitor.activeSegment);

  useEffect(() => {
    setNote(monitor.activeSegment?.note ?? "");
  }, [monitor.activeSegment?.id, monitor.activeSegment?.note]);

  const saveNote = () => {
    if (!canEdit) return;
    void monitor.changeActiveNote(note);
  };

  return (
    <label className="note-editor">
      备注
      <textarea
        value={note}
        disabled={!canEdit}
        placeholder={canEdit ? "这段时间的细节" : "开始忙碌或休息后可记录"}
        rows={3}
        onChange={(event) => setNote(event.target.value)}
        onBlur={saveNote}
      />
    </label>
  );
}

function TimelinePage({
  monitor,
  chronologicalSegments,
  timelineSegments,
  selectedDateLabel,
}: {
  monitor: MonitorController;
  chronologicalSegments: TimelineSegment[];
  timelineSegments: TimelineSegment[];
  selectedDateLabel: string;
}) {
  const previousSegmentById = useMemo(() => {
    return new Map(
      chronologicalSegments.map((segment, index) => [
        segment.id,
        index > 0 ? chronologicalSegments[index - 1] : null,
      ]),
    );
  }, [chronologicalSegments]);

  return (
    <section className="timeline-section">
      <div className="section-head">
        <div>
          <p className="eyebrow">时间线</p>
          <h2>{selectedDateLabel}每段时间</h2>
        </div>
        <button type="button" className="icon-button" onClick={() => void monitor.refresh()}>
          <RefreshCw aria-hidden="true" />
          <span>刷新</span>
        </button>
      </div>
      <BackfillPanel monitor={monitor} />
      <div className="timeline">
        {timelineSegments.length === 0 ? (
          <p className="empty-text">这一天还没有记录。切换日期可以查看其他自然日的时间线。</p>
        ) : (
          timelineSegments.map((segment) => (
            <TimelineRow
              key={segment.id}
              segment={segment}
              selectedDate={monitor.selectedDate}
              previous={previousSegmentById.get(segment.id) ?? null}
              isActive={segment.id === monitor.activeSegment?.id}
              onUpdate={monitor.updateSegment}
              onSplit={monitor.splitSegment}
              onMerge={monitor.mergeWithPrevious}
              onDelete={monitor.deleteSegment}
            />
          ))
        )}
      </div>
    </section>
  );
}

interface BackfillDraft {
  state: TrackableState;
  taskName: string;
  note: string;
  startMinute: number;
  endMinute: number;
}

interface BackfillDragState {
  mode: BackfillDragMode;
  pointerMinute: number;
  startMinute: number;
  endMinute: number;
}

interface RulerPanState {
  pointerId: number;
  startX: number;
  startY: number;
  scrollLeft: number;
  didPan: boolean;
}

interface RulerSegmentBlock {
  id: string;
  state: TrackableState;
  startMinute: number;
  endMinute: number;
}

function BackfillPanel({ monitor }: { monitor: MonitorController }) {
  const [draft, setDraft] = useState<BackfillDraft>(() => createDefaultBackfillDraft(monitor.selectedDate));
  const [isExpanded, setIsExpanded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [rulerZoom, setRulerZoom] = useState<(typeof RULER_ZOOM_LEVELS)[number]>(1);
  const rulerRef = useRef<HTMLDivElement>(null);
  const rulerScrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<BackfillDragState | null>(null);
  const rulerPanRef = useRef<RulerPanState | null>(null);
  const [isRulerPanning, setIsRulerPanning] = useState(false);
  const maxSelectableMinute = getBackfillMaxMinute(monitor.selectedDate);
  const hourMarks = useMemo(() => Array.from({ length: 9 }, (_, index) => index * 180), []);
  const zoomIndex = RULER_ZOOM_LEVELS.indexOf(rulerZoom);
  const occupiedBlocks = useMemo(
    () =>
      monitor.segments
        .map((segment) => getRulerSegmentBlock(segment, monitor.selectedDate))
        .filter((block): block is RulerSegmentBlock => Boolean(block)),
    [monitor.segments, monitor.selectedDate],
  );

  useEffect(() => {
    setDraft(createDefaultBackfillDraft(monitor.selectedDate));
    setMessage(null);
    setIsExpanded(false);
  }, [monitor.selectedDate]);

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      ...clampBackfillSelection(current.startMinute, current.endMinute, maxSelectableMinute),
    }));
  }, [maxSelectableMinute]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      const ruler = rulerRef.current;
      if (!drag || !ruler) return;

      event.preventDefault();
      const pointerMinute = minuteFromClientX(event.clientX, ruler, maxSelectableMinute);

      setDraft((current) => {
        if (drag.mode === "start") {
          return {
            ...current,
            ...clampBackfillSelection(Math.min(pointerMinute, drag.endMinute - RULER_STEP_MINUTES), drag.endMinute, maxSelectableMinute),
          };
        }

        if (drag.mode === "end") {
          return {
            ...current,
            ...clampBackfillSelection(drag.startMinute, Math.max(pointerMinute, drag.startMinute + RULER_STEP_MINUTES), maxSelectableMinute),
          };
        }

        const duration = Math.max(RULER_STEP_MINUTES, drag.endMinute - drag.startMinute);
        const maxStart = Math.max(0, maxSelectableMinute - duration);
        const nextStart = snapMinute(clamp(drag.startMinute + pointerMinute - drag.pointerMinute, 0, maxStart));
        return {
          ...current,
          ...clampBackfillSelection(nextStart, nextStart + duration, maxSelectableMinute),
        };
      });
    };

    const stopDrag = () => {
      dragRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
    };
  }, [maxSelectableMinute]);

  const setBackfillRange = (startMinute: number, endMinute: number) => {
    setDraft((current) => ({
      ...current,
      ...clampBackfillSelection(startMinute, endMinute, maxSelectableMinute),
    }));
    setMessage(null);
  };

  const startBackfillDrag = (event: ReactPointerEvent<HTMLElement>, mode: BackfillDragMode) => {
    const ruler = rulerRef.current;
    if (!ruler || maxSelectableMinute < RULER_STEP_MINUTES) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      mode,
      pointerMinute: minuteFromClientX(event.clientX, ruler, maxSelectableMinute),
      startMinute: draft.startMinute,
      endMinute: draft.endMinute,
    };
  };

  const moveSelectionToClientX = (clientX: number) => {
    const ruler = rulerRef.current;
    if (!ruler) return;
    if (maxSelectableMinute < RULER_STEP_MINUTES) return;

    const pointerMinute = minuteFromClientX(clientX, ruler, maxSelectableMinute);
    const duration = Math.max(RULER_STEP_MINUTES, draft.endMinute - draft.startMinute);
    const maxStart = Math.max(0, maxSelectableMinute - duration);
    const nextStart = snapMinute(clamp(pointerMinute - duration / 2, 0, maxStart));
    setBackfillRange(nextStart, nextStart + duration);
  };

  const startRulerPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const scroll = rulerScrollRef.current;
    if (event.button !== 0 || !scroll || target.closest(".backfill-selection, .backfill-handle")) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    rulerPanRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: scroll.scrollLeft,
      didPan: false,
    };
  };

  const moveRulerPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = rulerPanRef.current;
    const scroll = rulerScrollRef.current;
    if (!pan || !scroll || pan.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - pan.startX;
    const deltaY = event.clientY - pan.startY;
    if (Math.abs(deltaX) < 4 && Math.abs(deltaY) < 4) return;

    event.preventDefault();
    pan.didPan = true;
    setIsRulerPanning(true);
    scroll.scrollLeft = pan.scrollLeft - deltaX;
  };

  const stopRulerPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = rulerPanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;

    rulerPanRef.current = null;
    setIsRulerPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!pan.didPan && event.type === "pointerup") {
      moveSelectionToClientX(event.clientX);
    }
  };

  const updateStartTime = (value: string) => {
    const minute = minuteFromTimeInput(value);
    if (minute === null) return;
    setBackfillRange(minute, draft.endMinute);
  };

  const updateEndTime = (value: string) => {
    const minute = minuteFromTimeInput(value);
    if (minute === null) return;
    setBackfillRange(draft.startMinute, minute);
  };

  const setRulerZoomAround = useCallback((nextZoom: (typeof RULER_ZOOM_LEVELS)[number], anchorClientX?: number) => {
    const scroll = rulerScrollRef.current;
    const previousWidth = RULER_BASE_WIDTH_PX * rulerZoom;
    let anchorRatio = 0;
    let anchorOffset = 0;

    if (scroll && anchorClientX !== undefined && previousWidth > 0) {
      const rect = scroll.getBoundingClientRect();
      anchorOffset = clamp(anchorClientX - rect.left, 0, rect.width);
      anchorRatio = clamp((scroll.scrollLeft + anchorOffset) / previousWidth, 0, 1);
    }

    setRulerZoom(nextZoom);

    if (!scroll || anchorClientX === undefined) return;

    window.requestAnimationFrame(() => {
      const nextWidth = RULER_BASE_WIDTH_PX * nextZoom;
      const maxScrollLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
      scroll.scrollLeft = clamp(anchorRatio * nextWidth - anchorOffset, 0, maxScrollLeft);
    });
  }, [rulerZoom]);

  const changeRulerZoom = useCallback((direction: -1 | 1, anchorClientX?: number) => {
    const nextIndex = clamp(zoomIndex + direction, 0, RULER_ZOOM_LEVELS.length - 1);
    if (nextIndex === zoomIndex) return;
    setRulerZoomAround(RULER_ZOOM_LEVELS[nextIndex] ?? rulerZoom, anchorClientX);
  }, [rulerZoom, setRulerZoomAround, zoomIndex]);

  useEffect(() => {
    const scroll = rulerScrollRef.current;
    if (!scroll) return;

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      changeRulerZoom(event.deltaY < 0 ? 1 : -1, event.clientX);
    };

    scroll.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      scroll.removeEventListener("wheel", handleWheel);
    };
  }, [changeRulerZoom]);

  const submitBackfill = async (event: FormEvent) => {
    event.preventDefault();
    const range = clampBackfillSelection(draft.startMinute, draft.endMinute, maxSelectableMinute);

    if (range.endMinute <= range.startMinute || range.endMinute > maxSelectableMinute) {
      setMessage("结束时间需要晚于开始时间。");
      return;
    }

    const added = await monitor.addManualSegment({
      state: draft.state,
      taskName: draft.taskName,
      note: draft.note,
      startedAt: isoFromLocalMinute(monitor.selectedDate, range.startMinute),
      endedAt: isoFromLocalMinute(monitor.selectedDate, range.endMinute),
    });
    if (!added) {
      setMessage("补记失败：时间和已有记录重叠或格式有误。");
      return;
    }

    setMessage("已添加补记。");
    setDraft((current) => advanceBackfillDraft(current, maxSelectableMinute));
  };

  const canSubmit = draft.endMinute > draft.startMinute && draft.endMinute <= maxSelectableMinute;
  const selectionLeft = toRulerPercent(draft.startMinute);
  const selectionWidth = toRulerPercent(Math.max(0, draft.endMinute - draft.startMinute));
  const latestStartMinute = Math.max(0, Math.min(maxSelectableMinute - RULER_STEP_MINUTES, DAY_MINUTES - RULER_STEP_MINUTES));
  const latestEndInputMinute = Math.max(0, Math.min(maxSelectableMinute, DAY_MINUTES - RULER_STEP_MINUTES));
  const rulerWidth = RULER_BASE_WIDTH_PX * rulerZoom;
  const draftDuration = formatDuration((draft.endMinute - draft.startMinute) * 60);

  if (!isExpanded) {
    return (
      <section className="backfill-form backfill-collapsed" aria-label="补记时间">
        <div className="backfill-collapsed-copy">
          <p className="eyebrow">补记</p>
          <strong>
            {formatMinuteLabel(draft.startMinute)} - {formatMinuteLabel(draft.endMinute)}
          </strong>
          <span>
            {draftDuration} · {trackableStateLabels[draft.state]} · {draft.taskName || "补记任务"}
          </span>
        </div>
        <button type="button" className="icon-button" onClick={() => setIsExpanded(true)}>
          <ChevronDown aria-hidden="true" />
          <span>展开补记</span>
        </button>
      </section>
    );
  }

  return (
    <form className="backfill-form is-expanded" onSubmit={submitBackfill}>
      <div className="backfill-ruler-panel">
        <div className="backfill-ruler-head">
          <div>
            <p className="eyebrow">补记时间</p>
            <strong>
              {formatMinuteLabel(draft.startMinute)} - {formatMinuteLabel(draft.endMinute)}
            </strong>
            <div className="backfill-ruler-legend" aria-label="时间尺图例">
              <span className="legend-item">
                <i className="legend-swatch busy" aria-hidden="true" />
                已有忙碌
              </span>
              <span className="legend-item">
                <i className="legend-swatch rest" aria-hidden="true" />
                已有休息
              </span>
              <span className="legend-item">
                <i className={`legend-swatch selection ${draft.state}`} aria-hidden="true" />
                补记范围
              </span>
            </div>
          </div>
          <div className="backfill-ruler-tools" aria-label="时间尺缩放">
            <span>{draftDuration}</span>
            <button
              type="button"
              className="icon-only"
              disabled={zoomIndex <= 0}
              onClick={() => changeRulerZoom(-1)}
              title="缩小时间尺"
              aria-label="缩小时间尺"
            >
              <ZoomOut aria-hidden="true" />
            </button>
            <strong className="ruler-zoom-label">{formatRulerZoomLabel(rulerZoom)}</strong>
            <button
              type="button"
              className="icon-only"
              disabled={zoomIndex >= RULER_ZOOM_LEVELS.length - 1}
              onClick={() => changeRulerZoom(1)}
              title="放大时间尺"
              aria-label="放大时间尺"
            >
              <ZoomIn aria-hidden="true" />
            </button>
            <button type="button" className="icon-button" onClick={() => setIsExpanded(false)}>
              <ChevronUp aria-hidden="true" />
              <span>收起</span>
            </button>
          </div>
        </div>
        <div
          ref={rulerScrollRef}
          className={`backfill-ruler-scroll ${isRulerPanning ? "is-panning" : ""}`}
          title="滚轮缩放时间尺"
          onPointerDown={startRulerPan}
          onPointerMove={moveRulerPan}
          onPointerUp={stopRulerPan}
          onPointerCancel={stopRulerPan}
        >
          <div
            ref={rulerRef}
            className="backfill-ruler"
            style={{ width: `${rulerWidth}px`, minWidth: `${rulerWidth}px` }}
            role="presentation"
          >
            {hourMarks.map((minute) => (
              <div key={minute} className="ruler-tick" style={{ left: `${toRulerPercent(minute)}%` }}>
                <span>{formatHourMark(minute)}</span>
              </div>
            ))}
            {occupiedBlocks.map((block) => (
              <div
                key={block.id}
                className={`ruler-segment ${block.state}`}
                style={{
                  left: `${toRulerPercent(block.startMinute)}%`,
                  width: `${Math.max(0.3, toRulerPercent(block.endMinute - block.startMinute))}%`,
                }}
                title={`${trackableStateLabels[block.state]} ${formatMinuteLabel(block.startMinute)} - ${formatMinuteLabel(block.endMinute)}`}
              />
            ))}
            {maxSelectableMinute < DAY_MINUTES && (
              <div
                className="ruler-future"
                style={{
                  left: `${toRulerPercent(maxSelectableMinute)}%`,
                  width: `${toRulerPercent(DAY_MINUTES - maxSelectableMinute)}%`,
                }}
              />
            )}
            <div
              className={`backfill-selection ${draft.state}`}
              style={{ left: `${selectionLeft}%`, width: `${selectionWidth}%` }}
              onPointerDown={(event) => startBackfillDrag(event, "range")}
            >
              <button
                type="button"
                className="backfill-handle start"
                aria-label="调整开始时间"
                title="调整开始时间"
                onPointerDown={(event) => startBackfillDrag(event, "start")}
              />
              <button
                type="button"
                className="backfill-handle end"
                aria-label="调整结束时间"
                title="调整结束时间"
                onPointerDown={(event) => startBackfillDrag(event, "end")}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="backfill-fields">
        <label>
          类型
          <select
            value={draft.state}
            onChange={(event) =>
              setDraft((current) => ({ ...current, state: event.target.value as TrackableState }))
            }
          >
            <option value="busy">忙碌</option>
            <option value="rest">休息</option>
          </select>
        </label>
        <label className="backfill-task">
          内容
          <input
            value={draft.taskName}
            placeholder={draft.state === "busy" ? "补记任务" : "休息内容"}
            onChange={(event) => setDraft((current) => ({ ...current, taskName: event.target.value }))}
          />
        </label>
        <label className="backfill-note">
          备注
          <textarea
            value={draft.note}
            placeholder="补记备注"
            rows={2}
            onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
          />
        </label>
        <label>
          开始
          <input
            type="time"
            step={RULER_STEP_MINUTES * 60}
            value={timeInputValueFromMinute(draft.startMinute)}
            max={timeInputValueFromMinute(latestStartMinute)}
            disabled={maxSelectableMinute < RULER_STEP_MINUTES}
            onChange={(event) => updateStartTime(event.target.value)}
          />
        </label>
        <label>
          结束
          <input
            type="time"
            step={RULER_STEP_MINUTES * 60}
            value={timeInputValueFromMinute(Math.min(draft.endMinute, DAY_MINUTES - RULER_STEP_MINUTES))}
            min={timeInputValueFromMinute(RULER_STEP_MINUTES)}
            max={timeInputValueFromMinute(latestEndInputMinute)}
            disabled={maxSelectableMinute < RULER_STEP_MINUTES}
            onChange={(event) => updateEndTime(event.target.value)}
          />
        </label>
        <button type="submit" className="icon-button primary" disabled={!canSubmit}>
          <Plus aria-hidden="true" />
          <span>添加补记</span>
        </button>
        {message && <p className="inline-message">{message}</p>}
      </div>
    </form>
  );
}

function StatsPage({ monitor, selectedDateLabel }: { monitor: MonitorController; selectedDateLabel: string }) {
  const distribution = getTimeDistributionSegments(monitor.stats);
  const rhythm = describeRhythm(
    monitor.stats.rhythmDeviationDirection,
    monitor.stats.rhythmDeviationSeconds,
  );

  return (
    <section className="stats-page">
      <section className="stats-panel stats-wide" aria-label={`${selectedDateLabel}统计`}>
        <div className="panel-head">
          <h2>{formatDateLabel(monitor.selectedDate, false)}</h2>
        </div>
        <div className="stat-row">
          <Metric
            label="番茄钟"
            value={`${monitor.stats.pomodoroCount} 个`}
            icon={<span className="metric-tomato" aria-hidden="true">🍅</span>}
            accent
          />
          <Metric label="节奏偏离" value={rhythm.metricValue} tone={rhythm.tone} hint={rhythm.detail} />
          <Metric
            label="待补记忙碌"
            value={formatDuration(monitor.stats.unmarkedSeconds)}
            hint="空闲中被判定为应忙碌的时间，记得去时间线补记"
          />
        </div>
      </section>

      <div className="summary-layout">
        <SummaryEditor
          title="本日总结"
          subtitle={selectedDateLabel}
          content={monitor.daySummary?.content ?? ""}
          updatedAt={monitor.daySummary?.updatedAt ?? null}
          onSave={(content) => monitor.saveSummary("day", content)}
        />
        <SummaryEditor
          title="本周总结"
          subtitle={`周一 ${monitor.selectedWeekKey}`}
          content={monitor.weekSummary?.content ?? ""}
          updatedAt={monitor.weekSummary?.updatedAt ?? null}
          onSave={(content) => monitor.saveSummary("week", content)}
        />
      </div>

      <div className="analysis-layout">
        <section className="stats-panel chart-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">占比</p>
              <h2>时间分布</h2>
            </div>
          </div>
          <DonutChart title="忙碌 / 休息 / 空闲" segments={distribution} />
        </section>

        <section className="stats-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">任务耗时</p>
              <h2>忙碌内容分布</h2>
            </div>
          </div>
          <TaskStatsList tasks={monitor.stats.taskStats} emptyText="这一天还没有忙碌记录" showBars />
        </section>
      </div>
    </section>
  );
}

function SummaryEditor({
  title,
  subtitle,
  content,
  updatedAt,
  onSave,
}: {
  title: string;
  subtitle: string;
  content: string;
  updatedAt: string | null;
  onSave: (content: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(content);

  useEffect(() => {
    setDraft(content);
  }, [content]);

  useEffect(() => {
    if (draft === content) return;

    const timeout = window.setTimeout(() => {
      void onSave(draft);
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [content, draft, onSave]);

  return (
    <section className="stats-panel summary-editor">
      <div className="panel-head">
        <div>
          <p className="eyebrow">{subtitle}</p>
          <h2>{title}</h2>
        </div>
        {updatedAt && <span className="summary-updated">{formatDateTimeLabel(updatedAt)}</span>}
      </div>
      <textarea
        value={draft}
        rows={4}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== content) void onSave(draft);
        }}
      />
    </section>
  );
}

function SettingsPage({
  settingsDraft,
  setSettingsDraft,
  onAlwaysOnTopChange,
  onSubmit,
  onExportData,
  onRequestImport,
  importInputRef,
  onImportFile,
  dataTransferMessage,
}: {
  settingsDraft: LifeSettings;
  setSettingsDraft: (updater: (current: LifeSettings) => LifeSettings) => void;
  onAlwaysOnTopChange: (alwaysOnTop: boolean) => void;
  onSubmit: (event: FormEvent) => void;
  onExportData: () => void;
  onRequestImport: () => void;
  importInputRef: RefObject<HTMLInputElement | null>;
  onImportFile: (event: ChangeEvent<HTMLInputElement>) => void;
  dataTransferMessage: string | null;
}) {
  return (
    <section className="settings-section">
      <div className="section-head">
        <div>
          <p className="eyebrow">设置</p>
          <h2>提醒节奏</h2>
        </div>
      </div>
      <form className="settings-form" onSubmit={onSubmit}>
        <div className="settings-pair">
          <label>
            忙碌分钟
            <input
              type="number"
              min={1}
              max={240}
              value={settingsDraft.busyMinutes}
              onChange={(event) =>
                setSettingsDraft((current) => ({ ...current, busyMinutes: Number(event.target.value) }))
              }
            />
          </label>
          <label>
            休息分钟
            <input
              type="number"
              min={1}
              max={120}
              value={settingsDraft.restMinutes}
              onChange={(event) =>
                setSettingsDraft((current) => ({ ...current, restMinutes: Number(event.target.value) }))
              }
            />
          </label>
        </div>
        <div className="settings-checks">
        <label className="check-row">
          <input
            type="checkbox"
            checked={settingsDraft.soundEnabled}
            onChange={(event) =>
              setSettingsDraft((current) => ({ ...current, soundEnabled: event.target.checked }))
            }
          />
          <Volume2 aria-hidden="true" />
          声音提醒
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={settingsDraft.alwaysOnTop}
            onChange={(event) => onAlwaysOnTopChange(event.target.checked)}
          />
          <Pin aria-hidden="true" />
          窗口置顶
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={settingsDraft.autostart}
            onChange={(event) =>
              setSettingsDraft((current) => ({ ...current, autostart: event.target.checked }))
            }
          />
          <Settings2 aria-hidden="true" />
          开机自启
        </label>
        </div>
        <label className="close-behavior-editor">
          关闭窗口
          <select
            value={settingsDraft.closeWindowBehavior}
            onChange={(event) =>
              setSettingsDraft((current) => ({
                ...current,
                closeWindowBehavior: event.target.value as CloseWindowBehavior,
              }))
            }
          >
            <option value="ask">每次询问</option>
            <option value="minimize-to-tray">缩小到托盘</option>
            <option value="quit">直接退出</option>
          </select>
        </label>
        <label className="quick-task-editor">
          快捷任务
          <input
            value={settingsDraft.quickTasks.join(" / ")}
            onChange={(event) =>
              setSettingsDraft((current) => ({
                ...current,
                quickTasks: event.target.value.split("/"),
              }))
            }
          />
        </label>
        <button type="submit" className="icon-button primary">
          <Save aria-hidden="true" />
          <span>保存设置</span>
        </button>
      </form>
      <div className="settings-divider" />
      <div className="data-portability">
        <div>
          <p className="eyebrow">记录迁移</p>
          <h2>导入导出</h2>
        </div>
        <div className="data-actions">
          <button type="button" className="icon-button" onClick={onExportData}>
            <Download aria-hidden="true" />
            <span>导出记录</span>
          </button>
          <button type="button" className="icon-button" onClick={onRequestImport}>
            <Upload aria-hidden="true" />
            <span>导入记录</span>
          </button>
          <input
            ref={importInputRef}
            className="sr-only"
            type="file"
            accept="application/json,.json"
            onChange={onImportFile}
          />
        </div>
        {dataTransferMessage && (
          <StateFeedback tone="success" title="记录迁移结果" live="polite">
            {dataTransferMessage}
          </StateFeedback>
        )}
      </div>
    </section>
  );
}

function MiniReminderWindow({
  monitor,
  statusTone,
  onExpand,
}: {
  monitor: MonitorController;
  statusTone: string;
  onExpand: () => void;
}) {
  const isIdle = monitor.state === "idle";
  const idleTimeoutNotice = isIdle ? monitor.timeoutNotice : null;
  const previousStateText = idleTimeoutNotice
    ? `上一段：${trackableStateLabels[idleTimeoutNotice.state]} · ${idleTimeoutNotice.taskName ?? UNMARKED_TASK}`
    : null;
  const idleNoteText = previousStateText ?? "暂时不用记录";
  const taskName = monitor.snapshot.taskName ?? UNMARKED_TASK;
  const miniStateText = monitor.snapshot.isDue ? "超" : miniStateLabels[monitor.state];
  const miniStatusTitle = isIdle
    ? idleNoteText
    : `${stateLabels[monitor.state]} · ${getFocusTimerStatus(monitor)} · ${taskName}`;
  const miniTimerValue = getMiniTimerValue(monitor);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    void registerMiniWindowPositionTracking().then((nextUnlisten) => {
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
  }, []);

  const handleStartDrag = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    void startWindowDrag();
  };
  const handleStartResize = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    void startWindowResize();
  };
  const pauseAction =
    monitor.state === "paused"
      ? {
          label: "继续",
          title: "继续计时",
          icon: <Play aria-hidden="true" />,
          onClick: () => void monitor.resume(),
        }
      : {
          label: "暂停",
          title: "暂停计时",
          icon: <Pause aria-hidden="true" />,
          onClick: () => void monitor.pause(),
        };

  return (
    <main className={`app-shell mini-shell ${statusTone}`}>
      <div className="mini-drag-region" onMouseDown={handleStartDrag} title="拖动窗口" aria-hidden="true">
        <Grip aria-hidden="true" />
      </div>

      {monitor.error && <p className="mini-error">{monitor.error}</p>}

      <section className={`mini-status-chip ${statusTone}`} aria-live="polite" aria-label={miniStatusTitle} title={miniStatusTitle}>
        <span className="mini-status-dot" aria-hidden="true" />
        <span className="mini-state">{miniStateText}</span>
      </section>

      <strong className="mini-timer" title={getFocusTimerStatus(monitor)}>
        {miniTimerValue}
      </strong>

      <input
        className="mini-task-input"
        aria-label="活动内容"
        value={monitor.taskDraft}
        placeholder={isIdle ? "记" : "内容"}
        title={isIdle ? idleNoteText : taskName}
        onChange={(event) => monitor.setTaskDraft(event.target.value)}
      />

      <div className="mini-actions" aria-label="快捷操作">
        <button
          type="button"
          className="icon-only mini-action-button primary"
          onClick={() => void monitor.startBusy()}
          title="忙碌"
          aria-label="忙碌"
        >
          <BriefcaseBusiness aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-only mini-action-button rest"
          onClick={() => void monitor.startRest()}
          title="休息"
          aria-label="休息"
        >
          <Coffee aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-only mini-action-button"
          onClick={pauseAction.onClick}
          title={pauseAction.title}
          aria-label={pauseAction.label}
        >
          {pauseAction.icon}
        </button>
        {monitor.timeoutNotice && (
          <button
            type="button"
            className={`icon-only mini-action-button extend-to-now ${monitor.timeoutNotice.state}`}
            onClick={() => void monitor.extendTimeoutNoticeToNow()}
            title="把刚刚结束的状态补到现在"
            aria-label="补到现在"
          >
            <Clock3 aria-hidden="true" />
          </button>
        )}
        <button type="button" className="icon-only mini-action-button mini-expand" onClick={onExpand} title="展开完整界面">
          <Maximize2 aria-hidden="true" />
        </button>
      </div>

      <button type="button" className="mini-resize-handle" onMouseDown={handleStartResize} title="调整窗口大小">
        <Grip aria-hidden="true" />
        <span className="sr-only">调整窗口大小</span>
      </button>
    </main>
  );
}

function TimelineDateTimeInput({
  isoDate,
  selectedDate,
  disabled = false,
  title,
  containerClassName = "",
  onChange,
}: {
  isoDate: string | null;
  selectedDate: string;
  disabled?: boolean;
  title: string;
  containerClassName?: string;
  onChange: (isoDate: string | null) => void;
}) {
  const usesSelectedDate = !isoDate || isIsoOnLocalDate(isoDate, selectedDate);
  const value = isoDate ? (usesSelectedDate ? timeInputValueFromIso(isoDate) : toLocalInputValue(isoDate)) : "";

  return (
    <div className={`timeline-time-field ${usesSelectedDate ? "" : "is-cross-day"} ${containerClassName}`}>
      <input
        type={usesSelectedDate ? "time" : "datetime-local"}
        step={usesSelectedDate ? RULER_STEP_MINUTES * 60 : undefined}
        disabled={disabled}
        value={value}
        title={title}
        onChange={(event) => {
          if (!event.target.value) {
            onChange(null);
            return;
          }

          const nextIso = usesSelectedDate
            ? isoFromLocalTimeInput(selectedDate, event.target.value)
            : maybeFromLocalInputValue(event.target.value);
          if (nextIso) onChange(nextIso);
        }}
      />
      {!usesSelectedDate && <span className="cross-day-tag">跨日</span>}
    </div>
  );
}

function TimelineRow({
  segment,
  selectedDate,
  previous,
  isActive,
  onUpdate,
  onSplit,
  onMerge,
  onDelete,
}: {
  segment: TimelineSegment;
  selectedDate: string;
  previous: TimelineSegment | null;
  isActive: boolean;
  onUpdate: (segment: TimelineSegment) => Promise<void>;
  onSplit: (segment: TimelineSegment, splitAtIso: string) => Promise<void>;
  onMerge: (segment: TimelineSegment) => Promise<void>;
  onDelete: (segment: TimelineSegment) => Promise<void>;
}) {
  const [draft, setDraft] = useState(segment);
  const [splitAt, setSplitAt] = useState(() => midpointIso(segment));
  const [isEditing, setIsEditing] = useState(false);
  const [isSplitOpen, setIsSplitOpen] = useState(false);
  const canMerge = previous ? canMergeSegments(previous, segment) : false;
  const displaySegment = normalizeTimelineDraft(draft) ?? segment;
  const segmentSeconds = durationFor(displaySegment);
  const startedLabel = formatTimelineBoundary(displaySegment.startedAt, selectedDate);
  const endedLabel = displaySegment.endedAt ? formatTimelineBoundary(displaySegment.endedAt, selectedDate) : "进行中";
  const taskLabel =
    normalizeTaskName(displaySegment.taskName) ?? (displaySegment.state === "busy" ? UNMARKED_TASK : "休息");
  const notePreview = displaySegment.note?.trim() ?? "";
  const handleMerge = () => {
    if (!previous || !canMerge) return;
    if (!window.confirm(buildMergeConfirmationMessage(previous, segment))) return;
    void onMerge(segment);
  };
  const handleSplit = async () => {
    if (!isSplitOpen) {
      setIsSplitOpen(true);
      return;
    }

    await onSplit(segment, splitAt);
    setIsSplitOpen(false);
  };

  useEffect(() => {
    setDraft(segment);
    setSplitAt(midpointIso(segment));
  }, [segment]);

  useEffect(() => {
    const normalizedDraft = normalizeTimelineDraft(draft);
    if (!normalizedDraft) return;
    if (!hasTimelineDraftChanges(normalizedDraft, segment)) return;
    if (!isPersistableTimelineDraft(normalizedDraft, isActive)) return;

    const timeout = window.setTimeout(() => {
      void onUpdate(normalizedDraft);
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [draft, isActive, onUpdate, segment]);

  return (
    <article className={`timeline-row ${displaySegment.state} ${isActive ? "active" : ""} ${isEditing ? "editing" : ""}`}>
      <aside className="timeline-range">
        <span className="timeline-range-time">
          {startedLabel} - {endedLabel}
        </span>
        <span className={`timeline-range-detail ${displaySegment.state}`}>
          <strong>{formatDuration(segmentSeconds)}</strong>
          <span aria-hidden="true">·</span>
          <span>{trackableStateLabels[displaySegment.state]}</span>
        </span>
      </aside>
      <section className="timeline-content">
        <div className="timeline-read-row">
          <strong className="timeline-task-title">{taskLabel}</strong>
          <div className="timeline-meta">
            {segmentOvertimeSeconds(displaySegment) > 0 && (
              <span className="time-delta overtime">超时 {formatDuration(segmentOvertimeSeconds(displaySegment))}</span>
            )}
            {segmentUndertimeSeconds(displaySegment) > 0 && (
              <span className="time-delta undertime">不足 {formatDuration(segmentUndertimeSeconds(displaySegment))}</span>
            )}
            {isActive && <span className="live-tag">进行中</span>}
          </div>
        </div>
        {!isEditing && notePreview && <p className="timeline-note-preview">{notePreview}</p>}
        {isEditing && (
          <div className="timeline-fields">
            <select
              className="timeline-state-select"
              value={draft.state}
              onChange={(event) => setDraft((current) => ({ ...current, state: event.target.value as TrackableState }))}
            >
              <option value="busy">忙碌</option>
              <option value="rest">休息</option>
            </select>
            <input
              className="timeline-task-input"
              value={draft.taskName ?? ""}
              placeholder={draft.state === "busy" ? UNMARKED_TASK : "休息内容"}
              onChange={(event) => setDraft((current) => ({ ...current, taskName: event.target.value }))}
            />
            <TimelineDateTimeInput
              isoDate={draft.startedAt}
              selectedDate={selectedDate}
              containerClassName="timeline-start-input"
              title="开始时间"
              onChange={(startedAt) => {
                if (!startedAt) return;
                setDraft((current) => ({ ...current, startedAt }));
              }}
            />
            <TimelineDateTimeInput
              isoDate={draft.endedAt}
              selectedDate={selectedDate}
              containerClassName="timeline-end-input"
              disabled={isActive}
              title="结束时间"
              onChange={(endedAt) => setDraft((current) => ({ ...current, endedAt }))}
            />
            <textarea
              className="timeline-note"
              value={draft.note ?? ""}
              placeholder="备注"
              rows={2}
              onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
            />
          </div>
        )}
      </section>
      <div className="row-actions">
        <button
          type="button"
          className={`icon-button timeline-edit-button ${isEditing ? "primary" : ""}`}
          onClick={() => setIsEditing((current) => !current)}
        >
          {isEditing ? <Check aria-hidden="true" /> : <Pencil aria-hidden="true" />}
          {isEditing ? "完成" : "编辑"}
        </button>
        <button
          type="button"
          className={`icon-only ${isSplitOpen ? "active" : ""}`}
          onClick={() => void handleSplit()}
          title={isSplitOpen ? "确认拆分" : "拆分时间点"}
        >
          <Scissors aria-hidden="true" />
        </button>
        {isSplitOpen && (
          <TimelineDateTimeInput
            isoDate={splitAt}
            selectedDate={selectedDate}
            containerClassName="split-input"
            title="拆分时间点"
            onChange={(nextSplitAt) => {
              if (nextSplitAt) setSplitAt(nextSplitAt);
            }}
          />
        )}
        <button
          type="button"
          className="icon-only"
          disabled={!canMerge}
          onClick={handleMerge}
          title="与下方一段合并"
        >
          <Merge className="merge-down-icon" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-only danger"
          disabled={isActive}
          onClick={() => void onDelete(segment)}
          title="删除这一段"
        >
          <Trash2 aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

function createDefaultBackfillDraft(selectedDate: string): BackfillDraft {
  const maxSelectableMinute = getBackfillMaxMinute(selectedDate);
  const defaultEndMinute =
    selectedDate === toDateInputValue(new Date()) ? maxSelectableMinute : 10 * 60 + DEFAULT_BACKFILL_MINUTES;
  const endMinute = clamp(snapMinute(defaultEndMinute), 0, maxSelectableMinute);
  const startMinute = Math.max(0, endMinute - DEFAULT_BACKFILL_MINUTES);

  return {
    state: "busy",
    taskName: "",
    note: "",
    ...clampBackfillSelection(startMinute, endMinute, maxSelectableMinute),
  };
}

function buildMergeConfirmationMessage(previous: TimelineSegment, segment: TimelineSegment): string {
  const stateLabel = trackableStateLabels[segment.state];
  const taskName = normalizeTaskName(segment.taskName) ?? normalizeTaskName(previous.taskName) ?? UNMARKED_TASK;
  const gapSeconds = previous.endedAt
    ? Math.max(0, Math.round((new Date(segment.startedAt).getTime() - new Date(previous.endedAt).getTime()) / 1000))
    : 0;
  const lines = [
    `确定要合并这两段${stateLabel}记录吗？`,
    `内容：${taskName}`,
    `上一段：${formatSegmentRangeLabel(previous)}`,
    `当前段：${formatSegmentRangeLabel(segment)}`,
  ];

  if (gapSeconds > 0) {
    lines.push(`两段之间有 ${formatDuration(gapSeconds)} 空档，合并后会计入${stateLabel}时长。`);
  }

  lines.push("合并后会保留上一段的开始时间和当前段的结束时间。");
  return lines.join("\n");
}

function formatSegmentRangeLabel(segment: TimelineSegment): string {
  return `${formatDateTimeLabel(segment.startedAt)} - ${
    segment.endedAt ? formatDateTimeLabel(segment.endedAt) : "进行中"
  }`;
}

function formatTimelineBoundary(isoDate: string, selectedDate: string): string {
  return isIsoOnLocalDate(isoDate, selectedDate) ? timeInputValueFromIso(isoDate) : formatDateTimeLabel(isoDate);
}

function advanceBackfillDraft(current: BackfillDraft, maxSelectableMinute: number): BackfillDraft {
  const startMinute = clamp(current.endMinute, 0, Math.max(0, maxSelectableMinute - RULER_STEP_MINUTES));
  const endMinute = Math.min(maxSelectableMinute, startMinute + DEFAULT_BACKFILL_MINUTES);

  return {
    ...current,
    taskName: "",
    note: "",
    ...clampBackfillSelection(startMinute, endMinute, maxSelectableMinute),
  };
}

function getBackfillMaxMinute(selectedDate: string): number {
  const today = new Date();
  if (selectedDate !== toDateInputValue(today)) return DAY_MINUTES;
  return clamp(floorMinuteToStep(getLocalMinuteOfDay(today)), 0, DAY_MINUTES);
}

function clampBackfillSelection(
  startMinute: number,
  endMinute: number,
  maxSelectableMinute: number,
): Pick<BackfillDraft, "startMinute" | "endMinute"> {
  const maxMinute = Math.max(0, snapMinute(maxSelectableMinute));
  if (maxMinute < RULER_STEP_MINUTES) {
    return { startMinute: 0, endMinute: 0 };
  }

  let nextStart = clamp(snapMinute(startMinute), 0, maxMinute - RULER_STEP_MINUTES);
  let nextEnd = clamp(snapMinute(endMinute), RULER_STEP_MINUTES, maxMinute);

  if (nextEnd <= nextStart) {
    if (nextStart + RULER_STEP_MINUTES <= maxMinute) {
      nextEnd = nextStart + RULER_STEP_MINUTES;
    } else {
      nextStart = Math.max(0, maxMinute - RULER_STEP_MINUTES);
      nextEnd = maxMinute;
    }
  }

  return {
    startMinute: nextStart,
    endMinute: nextEnd,
  };
}

function getRulerSegmentBlock(segment: TimelineSegment, selectedDate: string): RulerSegmentBlock | null {
  const dayStartMs = localDateFromKey(selectedDate).getTime();
  const dayEndMs = dayStartMs + DAY_MINUTES * 60_000;
  const startMs = Math.max(new Date(segment.startedAt).getTime(), dayStartMs);
  const endMs = Math.min(new Date(segment.endedAt ?? new Date().toISOString()).getTime(), dayEndMs);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;

  return {
    id: segment.id,
    state: segment.state,
    startMinute: (startMs - dayStartMs) / 60_000,
    endMinute: (endMs - dayStartMs) / 60_000,
  };
}

function minuteFromClientX(clientX: number, element: HTMLElement, maxSelectableMinute: number): number {
  const rect = element.getBoundingClientRect();
  const ratio = rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0;
  return clamp(snapMinute(ratio * DAY_MINUTES), 0, maxSelectableMinute);
}

async function saveJsonExport(data: unknown, fileName: string): Promise<string> {
  const content = JSON.stringify(data, null, 2);

  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("export_json_file", { fileName, content });
  }

  downloadJson(content, fileName);
  return `浏览器默认下载目录（通常是“下载”文件夹）/${fileName}`;
}

function downloadJson(content: string, fileName: string): void {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function getMiniTimerValue(monitor: MonitorController): string {
  if (monitor.state === "idle") return "[--]";
  if (monitor.state === "paused") return "[停]";

  const seconds = monitor.snapshot.isDue ? monitor.snapshot.overtimeSeconds : monitor.snapshot.remainingSeconds;
  return `[${formatMiniDuration(seconds)}]`;
}

function getFocusTimerStatus(monitor: MonitorController): string {
  if (monitor.state === "idle" || monitor.state === "paused") return "未计时";
  if (monitor.snapshot.isDue) return `多用 ${formatDuration(monitor.snapshot.overtimeSeconds)}`;
  return `剩余 ${formatDuration(monitor.snapshot.remainingSeconds)}`;
}

function getFocusTimerDisplay(monitor: MonitorController): string {
  if (monitor.state === "idle") return "--:--";
  if (monitor.state === "paused") return "暂停";
  const seconds = monitor.snapshot.isDue ? monitor.snapshot.overtimeSeconds : monitor.snapshot.remainingSeconds;
  return `${monitor.snapshot.isDue ? "+" : ""}${formatMiniDuration(seconds)}`;
}

function getStatusLabel(monitor: MonitorController): string {
  return monitor.snapshot.isDue ? `多用 ${formatDuration(monitor.snapshot.overtimeSeconds)}` : stateLabels[monitor.state];
}

function readWindowMode(): AppWindowMode {
  return window.localStorage.getItem(WINDOW_MODE_STORAGE_KEY) === "mini" ? "mini" : "full";
}

export default App;
