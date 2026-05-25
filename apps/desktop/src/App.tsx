import {
  BarChart3,
  BellRing,
  BriefcaseBusiness,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
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
  Pin,
  Play,
  Plus,
  RefreshCw,
  Save,
  Scissors,
  Settings2,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent, type RefObject } from "react";
import {
  DEFAULT_SETTINGS,
  UNMARKED_TASK,
  canMergeSegments,
  formatDuration,
  type CloseWindowBehavior,
  type LifeSettings,
  type TimelineSegment,
  type TrackableState,
} from "@lifemonitor/core";
import "./App.css";
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

type PageId = "today" | "timeline" | "stats" | "settings";
type MonitorController = ReturnType<typeof useLifeMonitor>;

const stateLabels = {
  idle: "空闲",
  busy: "忙碌",
  rest: "休息",
  paused: "暂停",
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

const pageCopy: Record<PageId, { eyebrow: string; title: string }> = {
  today: { eyebrow: "LifeMonitor", title: "今天在做什么" },
  timeline: { eyebrow: "记录回看", title: "时间线" },
  stats: { eyebrow: "数据回顾", title: "统计" },
  settings: { eyebrow: "应用偏好", title: "设置" },
};

function App() {
  const monitor = useLifeMonitor();
  const [settingsDraft, setSettingsDraft] = useState<LifeSettings>(DEFAULT_SETTINGS);
  const [windowMode, setWindowMode] = useState<AppWindowMode>(() => readWindowMode());
  const [activePage, setActivePage] = useState<PageId>("today");
  const importInputRef = useRef<HTMLInputElement>(null);
  const [dataTransferMessage, setDataTransferMessage] = useState<string | null>(null);

  useEffect(() => {
    setSettingsDraft(monitor.settings);
  }, [monitor.settings]);

  useEffect(() => {
    window.localStorage.setItem(WINDOW_MODE_STORAGE_KEY, windowMode);
    void syncWindowMode(windowMode);
  }, [windowMode]);

  const orderedSegments = useMemo(
    () => [...monitor.segments].sort((left, right) => left.startedAt.localeCompare(right.startedAt)),
    [monitor.segments],
  );
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
      setDataTransferMessage(`已导出 ${data.segments.length} 条记录到：${exportLocation}`);
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
      setDataTransferMessage(`已导入 ${data.segments.length} 条记录。`);
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
        <div>
          <p className="eyebrow">{pageCopy[activePage].eyebrow}</p>
          <h1>{pageCopy[activePage].title}</h1>
        </div>
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

      {monitor.error && <p className="error-line">{monitor.error}</p>}

      <div className="page-content">
        {activePage === "today" && <TodayPage monitor={monitor} />}
        {activePage === "timeline" && (
          <TimelinePage monitor={monitor} orderedSegments={orderedSegments} selectedDateLabel={selectedDateLabel} />
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
      <div>
        <p className="eyebrow">到点提醒</p>
        <h2>已自动回到空闲</h2>
        <p>{trackableStateLabels[notice.state]}已在 {formatDateTimeLabel(notice.endedAt)} 结束。</p>
        <p className="muted">上一段：{notice.taskName ?? UNMARKED_TASK}</p>
      </div>
      <div className="reminder-actions">
        <button type="button" className="icon-button primary" onClick={onOpenTimeline} title="打开时间线补记">
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

function TodayPage({ monitor }: { monitor: MonitorController }) {
  return (
    <section className="dashboard today-layout">
      <FocusPanel monitor={monitor} />
      <section className="stats-panel today-summary" aria-label="今日概览">
        <div className="panel-head">
          <div>
            <p className="eyebrow">今日概览</p>
            <h2>关键数据</h2>
          </div>
        </div>
        <div className="stat-list compact">
          <Metric label="忙碌总时长" value={formatDuration(monitor.stats.busySeconds)} />
          <Metric label="休息总时长" value={formatDuration(monitor.stats.restSeconds)} />
          <Metric label="待补记忙碌" value={formatDuration(monitor.stats.unmarkedSeconds)} />
        </div>
        <TaskStatsList tasks={monitor.stats.taskStats.slice(0, 4)} emptyText="今天还没有忙碌记录" />
      </section>
    </section>
  );
}

function FocusPanel({ monitor }: { monitor: MonitorController }) {
  const canExtend = monitor.state === "busy" || monitor.state === "rest";
  const timerStatusText = getFocusTimerStatus(monitor);

  return (
    <section className="focus-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">当前状态</p>
          <h2>{stateLabels[monitor.state]}</h2>
        </div>
        <div className={`due-text ${monitor.snapshot.isDue ? "is-soft-overdue" : ""}`}>
          {timerStatusText}
        </div>
      </div>

      <div className="timer-grid">
        <Metric label="已持续" value={formatDuration(monitor.snapshot.elapsedSeconds)} />
        <Metric label="目标" value={`${monitor.snapshot.targetMinutes} 分钟`} />
        <Metric label="当前任务" value={monitor.snapshot.taskName ?? UNMARKED_TASK} />
      </div>

      <div className="task-form">
        <label htmlFor="task-input">活动内容</label>
        <div className="task-input-row">
          <input
            id="task-input"
            value={monitor.taskDraft}
            placeholder="工作 / 散步 / 喝水"
            onChange={(event) => monitor.setTaskDraft(event.target.value)}
          />
        </div>
      </div>

      {monitor.settings.quickTasks.length > 0 && (
        <div className="quick-tasks">
          {monitor.settings.quickTasks.map((task) => (
            <button key={task} type="button" onClick={() => monitor.setTaskDraft(task)}>
              {task}
            </button>
          ))}
        </div>
      )}

      <div className="action-grid">
        <button type="button" className="icon-button primary" onClick={() => void monitor.startBusy()}>
          <Play aria-hidden="true" />
          <span>开始忙碌</span>
        </button>
        <button type="button" className="icon-button rest" onClick={() => void monitor.startRest()}>
          <Coffee aria-hidden="true" />
          <span>开始休息</span>
        </button>
        {monitor.state === "paused" ? (
          <button type="button" className="icon-button" onClick={() => void monitor.resume()}>
            <Play aria-hidden="true" />
            <span>继续</span>
          </button>
        ) : (
          <button type="button" className="icon-button" onClick={() => void monitor.pause()}>
            <Pause aria-hidden="true" />
            <span>暂停</span>
          </button>
        )}
        <button type="button" className="icon-button" disabled={!canExtend} onClick={() => void monitor.extend(5)}>
          <Clock3 aria-hidden="true" />
          <span>延长 5 分钟</span>
        </button>
        <button type="button" className="icon-button" disabled={!canExtend} onClick={() => void monitor.extend(10)}>
          <Clock3 aria-hidden="true" />
          <span>延长 10 分钟</span>
        </button>
      </div>
    </section>
  );
}

function TimelinePage({
  monitor,
  orderedSegments,
  selectedDateLabel,
}: {
  monitor: MonitorController;
  orderedSegments: TimelineSegment[];
  selectedDateLabel: string;
}) {
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
        {orderedSegments.length === 0 ? (
          <p className="empty-text">这一天还没有记录。切换日期可以查看其他自然日的时间线。</p>
        ) : (
          orderedSegments.map((segment, index) => (
            <TimelineRow
              key={segment.id}
              segment={segment}
              previous={index > 0 ? orderedSegments[index - 1] : null}
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
  startedAt: string;
  endedAt: string;
}

function BackfillPanel({ monitor }: { monitor: MonitorController }) {
  const [draft, setDraft] = useState<BackfillDraft>(() => createDefaultBackfillDraft(monitor.selectedDate));
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft(createDefaultBackfillDraft(monitor.selectedDate));
    setMessage(null);
  }, [monitor.selectedDate]);

  const submitBackfill = async (event: FormEvent) => {
    event.preventDefault();
    const startMs = new Date(draft.startedAt).getTime();
    const endMs = new Date(draft.endedAt).getTime();

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      setMessage("结束时间需要晚于开始时间。");
      return;
    }

    const added = await monitor.addManualSegment({
      state: draft.state,
      taskName: draft.taskName,
      startedAt: new Date(startMs).toISOString(),
      endedAt: new Date(endMs).toISOString(),
    });
    if (!added) return;

    setMessage("已添加补记。");
    setDraft((current) => advanceBackfillDraft(current));
  };

  return (
    <form className="backfill-form" onSubmit={submitBackfill}>
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
      <label>
        开始
        <input
          type="datetime-local"
          value={draft.startedAt}
          onChange={(event) => setDraft((current) => ({ ...current, startedAt: event.target.value }))}
        />
      </label>
      <label>
        结束
        <input
          type="datetime-local"
          value={draft.endedAt}
          onChange={(event) => setDraft((current) => ({ ...current, endedAt: event.target.value }))}
        />
      </label>
      <button type="submit" className="icon-button primary">
        <Plus aria-hidden="true" />
        <span>添加补记</span>
      </button>
      {message && <p className="inline-message">{message}</p>}
    </form>
  );
}

function StatsPage({ monitor, selectedDateLabel }: { monitor: MonitorController; selectedDateLabel: string }) {
  const totalTrackedSeconds = monitor.stats.busySeconds + monitor.stats.restSeconds;
  const busyRatio = percentage(monitor.stats.busySeconds, totalTrackedSeconds);
  const restRatio = percentage(monitor.stats.restSeconds, totalTrackedSeconds);

  return (
    <section className="stats-page">
      <section className="stats-panel stats-wide" aria-label={`${selectedDateLabel}统计`}>
        <div className="panel-head">
          <div>
            <p className="eyebrow">{monitor.isViewingToday ? "今日统计" : "历史统计"}</p>
            <h2>{selectedDateLabel}</h2>
          </div>
        </div>
        <div className="stat-list expanded">
          <Metric label="忙碌总时长" value={formatDuration(monitor.stats.busySeconds)} />
          <Metric label="休息总时长" value={formatDuration(monitor.stats.restSeconds)} />
          <Metric label="超时忙碌" value={formatDuration(monitor.stats.overtimeBusySeconds)} />
          <Metric label="超时休息" value={formatDuration(monitor.stats.overtimeRestSeconds)} />
          <Metric label="待补记忙碌" value={formatDuration(monitor.stats.unmarkedSeconds)} />
        </div>
      </section>

      <div className="analysis-layout">
        <section className="stats-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">占比</p>
              <h2>忙碌与休息</h2>
            </div>
          </div>
          <div className="balance-bars">
            <RatioBar label="忙碌" value={monitor.stats.busySeconds} ratio={busyRatio} tone="busy" />
            <RatioBar label="休息" value={monitor.stats.restSeconds} ratio={restRatio} tone="rest" />
          </div>
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
        {dataTransferMessage && <p className="inline-message">{dataTransferMessage}</p>}
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
  const timerLabel = getTimerLabel(monitor);
  const timerValue = getTimerValue(monitor);

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
      <div className="mini-drag-region" onMouseDown={handleStartDrag} aria-hidden="true" />

      {monitor.error && <p className="mini-error">{monitor.error}</p>}

      <section className="mini-status-line" aria-live="polite">
        <span className={`mini-state ${statusTone}`}>{stateLabels[monitor.state]}</span>
        <span className="mini-caption">{timerLabel}</span>
        <strong className="mini-timer">{timerValue}</strong>
        <span className="mini-task-name">{monitor.snapshot.taskName ?? UNMARKED_TASK}</span>
        <button type="button" className="icon-only mini-expand" onClick={onExpand} title="展开完整界面">
          <Maximize2 aria-hidden="true" />
        </button>
      </section>

      <div className="mini-control-row">
        <input
          aria-label="活动内容"
          value={monitor.taskDraft}
          placeholder="活动内容"
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
        </div>
      </div>
      <button type="button" className="mini-resize-handle" onMouseDown={handleStartResize} title="调整窗口大小">
        <Grip aria-hidden="true" />
        <span className="sr-only">调整窗口大小</span>
      </button>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RatioBar({
  label,
  value,
  ratio,
  tone,
}: {
  label: string;
  value: number;
  ratio: number;
  tone: "busy" | "rest";
}) {
  return (
    <div className="ratio-row">
      <div className="ratio-meta">
        <span>{label}</span>
        <strong>{formatDuration(value)}</strong>
        <em>{ratio}%</em>
      </div>
      <div className="progress-track">
        <div className={`progress-bar ${tone}`} style={{ width: `${ratio}%` }} />
      </div>
    </div>
  );
}

function TaskStatsList({
  tasks,
  emptyText,
  showBars = false,
}: {
  tasks: Array<{ taskName: string; seconds: number }>;
  emptyText: string;
  showBars?: boolean;
}) {
  const maxSeconds = Math.max(...tasks.map((task) => task.seconds), 0);

  return (
    <div className="task-stats">
      {tasks.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        tasks.map((task) => {
          const ratio = percentage(task.seconds, maxSeconds);
          return (
            <div key={task.taskName} className={`task-stat-row ${showBars ? "with-bar" : ""}`}>
              <span>{task.taskName}</span>
              <strong>{formatDuration(task.seconds)}</strong>
              {showBars && (
                <div className="progress-track task-progress">
                  <div className="progress-bar busy" style={{ width: `${ratio}%` }} />
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function TimelineRow({
  segment,
  previous,
  isActive,
  onUpdate,
  onSplit,
  onMerge,
  onDelete,
}: {
  segment: TimelineSegment;
  previous: TimelineSegment | null;
  isActive: boolean;
  onUpdate: (segment: TimelineSegment) => Promise<void>;
  onSplit: (segment: TimelineSegment, splitAtIso: string) => Promise<void>;
  onMerge: (segment: TimelineSegment) => Promise<void>;
  onDelete: (segment: TimelineSegment) => Promise<void>;
}) {
  const [draft, setDraft] = useState(segment);
  const [splitAt, setSplitAt] = useState(() => midpointInputValue(segment));
  const canMerge = previous ? canMergeSegments(previous, segment) : false;

  useEffect(() => {
    setDraft(segment);
    setSplitAt(midpointInputValue(segment));
  }, [segment]);

  const save = async () => {
    await onUpdate({
      ...draft,
      startedAt: fromLocalInputValue(toLocalInputValue(draft.startedAt)),
      endedAt: draft.endedAt ? fromLocalInputValue(toLocalInputValue(draft.endedAt)) : null,
    });
  };

  return (
    <article className={`timeline-row ${segment.state} ${isActive ? "active" : ""}`}>
      <div className="timeline-marker" />
      <div className="timeline-fields">
        <select
          value={draft.state}
          onChange={(event) => setDraft((current) => ({ ...current, state: event.target.value as TrackableState }))}
        >
          <option value="busy">忙碌</option>
          <option value="rest">休息</option>
        </select>
        <input
          value={draft.taskName ?? ""}
          placeholder={segment.state === "busy" ? UNMARKED_TASK : "休息内容"}
          onChange={(event) => setDraft((current) => ({ ...current, taskName: event.target.value }))}
        />
        <input
          type="datetime-local"
          value={toLocalInputValue(draft.startedAt)}
          onChange={(event) =>
            setDraft((current) => ({ ...current, startedAt: fromLocalInputValue(event.target.value) }))
          }
        />
        <input
          type="datetime-local"
          disabled={isActive}
          value={draft.endedAt ? toLocalInputValue(draft.endedAt) : ""}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              endedAt: event.target.value ? fromLocalInputValue(event.target.value) : null,
            }))
          }
        />
      </div>
      <div className="timeline-meta">
        <span>{trackableStateLabels[segment.state]}</span>
        <strong>{formatDuration(durationFor(segment))}</strong>
        {isActive && <span className="live-tag">进行中</span>}
      </div>
      <div className="row-actions">
        <button type="button" className="icon-only" onClick={() => void save()} title="保存这一段">
          <Save aria-hidden="true" />
        </button>
        <input
          className="split-input"
          type="datetime-local"
          value={splitAt}
          onChange={(event) => setSplitAt(event.target.value)}
          title="拆分时间点"
        />
        <button
          type="button"
          className="icon-only"
          onClick={() => void onSplit(segment, fromLocalInputValue(splitAt))}
          title="按时间点拆分"
        >
          <Scissors aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-only"
          disabled={!canMerge}
          onClick={() => void onMerge(segment)}
          title="与上一段合并"
        >
          <Merge aria-hidden="true" />
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
  const [year, month, day] = selectedDate.split("-").map(Number);
  const dayStart = new Date(year, month - 1, day, 0, 0, 0, 0);
  const dayEnd = new Date(year, month - 1, day, 23, 59, 0, 0);
  const now = new Date();
  now.setSeconds(0, 0);

  let end = selectedDate === toDateInputValue(now) ? now : new Date(year, month - 1, day, 10, 0, 0, 0);
  if (end.getTime() <= dayStart.getTime()) end = new Date(dayStart.getTime() + 30 * 60_000);
  if (end.getTime() > dayEnd.getTime()) end = dayEnd;

  let start = new Date(end.getTime() - 30 * 60_000);
  if (start.getTime() < dayStart.getTime()) start = dayStart;

  return {
    state: "busy",
    taskName: "",
    startedAt: toLocalInputValue(start.toISOString()),
    endedAt: toLocalInputValue(end.toISOString()),
  };
}

function advanceBackfillDraft(current: BackfillDraft): BackfillDraft {
  const startMs = new Date(current.endedAt).getTime();
  if (!Number.isFinite(startMs)) return current;

  return {
    ...current,
    taskName: "",
    startedAt: toLocalInputValue(new Date(startMs).toISOString()),
    endedAt: toLocalInputValue(new Date(startMs + 30 * 60_000).toISOString()),
  };
}

function formatDateTimeLabel(isoDate: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoDate));
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

function durationFor(segment: TimelineSegment): number {
  const end = segment.endedAt ?? new Date().toISOString();
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(segment.startedAt).getTime()) / 1000));
}

function midpointInputValue(segment: TimelineSegment): string {
  const end = segment.endedAt ?? new Date().toISOString();
  const midpoint = new Date((new Date(segment.startedAt).getTime() + new Date(end).getTime()) / 2);
  return toLocalInputValue(midpoint.toISOString());
}

function toLocalInputValue(isoDate: string): string {
  const date = new Date(isoDate);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromLocalInputValue(value: string): string {
  return new Date(value).toISOString();
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(value: string, isToday: boolean): string {
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

function clampMinutes(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function percentage(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

function getTimerLabel(monitor: MonitorController): string {
  if (monitor.state === "idle") return "未计时";
  if (monitor.state === "paused") return "已暂停";
  return monitor.snapshot.isDue ? "多用" : "剩余";
}

function getTimerValue(monitor: MonitorController): string {
  if (monitor.state === "idle" || monitor.state === "paused") return "0秒";
  return monitor.snapshot.isDue
    ? formatDuration(monitor.snapshot.overtimeSeconds)
    : formatDuration(monitor.snapshot.remainingSeconds);
}

function getFocusTimerStatus(monitor: MonitorController): string {
  if (monitor.state === "idle" || monitor.state === "paused") return "未计时";
  if (monitor.snapshot.isDue) return `多用 ${formatDuration(monitor.snapshot.overtimeSeconds)}`;
  return `剩余 ${formatDuration(monitor.snapshot.remainingSeconds)}`;
}

function getStatusLabel(monitor: MonitorController): string {
  return monitor.snapshot.isDue ? `多用 ${formatDuration(monitor.snapshot.overtimeSeconds)}` : stateLabels[monitor.state];
}

function readWindowMode(): AppWindowMode {
  return window.localStorage.getItem(WINDOW_MODE_STORAGE_KEY) === "mini" ? "mini" : "full";
}

export default App;
