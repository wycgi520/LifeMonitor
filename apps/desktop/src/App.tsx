import {
  BellRing,
  BriefcaseBusiness,
  Check,
  Clock3,
  Coffee,
  Merge,
  Pause,
  Pin,
  Play,
  RefreshCw,
  Save,
  Scissors,
  Settings2,
  Trash2,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  DEFAULT_SETTINGS,
  UNMARKED_TASK,
  canMergeSegments,
  formatDuration,
  type LifeSettings,
  type TimelineSegment,
  type TrackableState,
} from "@lifemonitor/core";
import "./App.css";
import { useLifeMonitor } from "./services/useLifeMonitor";

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

function App() {
  const monitor = useLifeMonitor();
  const [settingsDraft, setSettingsDraft] = useState<LifeSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setSettingsDraft(monitor.settings);
  }, [monitor.settings]);

  const orderedSegments = useMemo(
    () => [...monitor.segments].sort((left, right) => left.startedAt.localeCompare(right.startedAt)),
    [monitor.segments],
  );

  const statusTone = monitor.snapshot.isDue ? "is-due" : monitor.state;

  const submitTask = async (event: FormEvent) => {
    event.preventDefault();
    await monitor.changeTask(monitor.taskDraft);
  };

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    await monitor.saveSettings({
      ...settingsDraft,
      busyMinutes: clampMinutes(settingsDraft.busyMinutes, 1, 240),
      restMinutes: clampMinutes(settingsDraft.restMinutes, 1, 120),
      quickTasks: settingsDraft.quickTasks.map((task) => task.trim()).filter(Boolean),
    });
  };

  if (monitor.loading) {
    return (
      <main className="app-shell loading-shell">
        <Clock3 aria-hidden="true" />
        <p>正在加载 LifeMonitor</p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      {monitor.reminderVisible && (
        <section className="reminder" aria-live="assertive">
          <div>
            <p className="eyebrow">到点提醒</p>
            <h2>{monitor.state === "busy" ? "该休息一下了" : "休息时间到了"}</h2>
            <p>
              当前{stateLabels[monitor.state]}已持续 {formatDuration(monitor.snapshot.elapsedSeconds)}，超时{" "}
              {formatDuration(monitor.snapshot.overtimeSeconds)}。
            </p>
            <p className="muted">当前任务：{monitor.snapshot.taskName ?? UNMARKED_TASK}</p>
          </div>
          <div className="reminder-actions">
            <button type="button" className="icon-button" onClick={() => void monitor.extend(5)} title="延长 5 分钟">
              <Clock3 aria-hidden="true" />
              <span>5 分钟</span>
            </button>
            <button type="button" className="icon-button" onClick={() => void monitor.extend(10)} title="延长 10 分钟">
              <Clock3 aria-hidden="true" />
              <span>10 分钟</span>
            </button>
            {monitor.state === "busy" ? (
              <button type="button" className="icon-button primary" onClick={() => void monitor.startRest()} title="开始休息">
                <Coffee aria-hidden="true" />
                <span>开始休息</span>
              </button>
            ) : (
              <button type="button" className="icon-button primary" onClick={() => void monitor.startBusy()} title="继续忙碌">
                <BriefcaseBusiness aria-hidden="true" />
                <span>继续忙碌</span>
              </button>
            )}
            <button type="button" className="icon-button" onClick={monitor.acknowledgeReminder} title="继续当前状态">
              <Check aria-hidden="true" />
              <span>继续</span>
            </button>
            <button type="button" className="icon-button" onClick={() => void monitor.pause()} title="暂停记录">
              <Pause aria-hidden="true" />
              <span>暂停</span>
            </button>
          </div>
        </section>
      )}

      <header className="topbar">
        <div>
          <p className="eyebrow">LifeMonitor</p>
          <h1>今天在做什么</h1>
        </div>
        <div className={`status-pill ${statusTone}`}>
          <BellRing aria-hidden="true" />
          <span>{stateLabels[monitor.state]}</span>
        </div>
      </header>

      {monitor.error && <p className="error-line">{monitor.error}</p>}

      <section className="dashboard">
        <div className="focus-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">当前状态</p>
              <h2>{stateLabels[monitor.state]}</h2>
            </div>
            <div className="due-text">
              {monitor.state === "idle" || monitor.state === "paused"
                ? "未计时"
                : monitor.snapshot.isDue
                  ? `超时 ${formatDuration(monitor.snapshot.overtimeSeconds)}`
                  : `剩余 ${formatDuration(monitor.snapshot.remainingSeconds)}`}
            </div>
          </div>

          <div className="timer-grid">
            <Metric label="已持续" value={formatDuration(monitor.snapshot.elapsedSeconds)} />
            <Metric label="目标" value={`${monitor.snapshot.targetMinutes} 分钟`} />
            <Metric label="当前任务" value={monitor.snapshot.taskName ?? UNMARKED_TASK} />
          </div>

          <form className="task-form" onSubmit={(event) => void submitTask(event)}>
            <label htmlFor="task-input">当前任务</label>
            <div className="task-input-row">
              <input
                id="task-input"
                value={monitor.taskDraft}
                placeholder="写代码 / 看文档 / 开会"
                onChange={(event) => monitor.setTaskDraft(event.target.value)}
              />
              <button type="submit" className="icon-button" title="更换任务">
                <RefreshCw aria-hidden="true" />
                <span>更换任务</span>
              </button>
            </div>
          </form>

          <div className="quick-tasks">
            {monitor.settings.quickTasks.map((task) => (
              <button key={task} type="button" onClick={() => void monitor.changeTask(task)}>
                {task}
              </button>
            ))}
          </div>

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
            <button type="button" className="icon-button" onClick={() => void monitor.extend(5)}>
              <Clock3 aria-hidden="true" />
              <span>延长 5 分钟</span>
            </button>
            <button type="button" className="icon-button" onClick={() => void monitor.extend(10)}>
              <Clock3 aria-hidden="true" />
              <span>延长 10 分钟</span>
            </button>
          </div>
        </div>

        <section className="stats-panel" aria-label="今日统计">
          <div className="panel-head">
            <div>
              <p className="eyebrow">今日统计</p>
              <h2>本地自然日</h2>
            </div>
          </div>
          <div className="stat-list">
            <Metric label="忙碌总时长" value={formatDuration(monitor.stats.busySeconds)} />
            <Metric label="休息总时长" value={formatDuration(monitor.stats.restSeconds)} />
            <Metric label="超时忙碌" value={formatDuration(monitor.stats.overtimeBusySeconds)} />
            <Metric label="超时休息" value={formatDuration(monitor.stats.overtimeRestSeconds)} />
            <Metric label="待补记忙碌" value={formatDuration(monitor.stats.unmarkedSeconds)} />
          </div>
          <div className="task-stats">
            <h3>任务耗时</h3>
            {monitor.stats.taskStats.length === 0 ? (
              <p className="muted">还没有忙碌记录</p>
            ) : (
              monitor.stats.taskStats.map((task) => (
                <div key={task.taskName} className="task-stat-row">
                  <span>{task.taskName}</span>
                  <strong>{formatDuration(task.seconds)}</strong>
                </div>
              ))
            )}
          </div>
        </section>
      </section>

      <section className="timeline-section">
        <div className="section-head">
          <div>
            <p className="eyebrow">时间线</p>
            <h2>今天每段时间</h2>
          </div>
          <button type="button" className="icon-button" onClick={() => void monitor.refresh()}>
            <RefreshCw aria-hidden="true" />
            <span>刷新</span>
          </button>
        </div>
        <div className="timeline">
          {orderedSegments.length === 0 ? (
            <p className="empty-text">还没有记录。开始忙碌或休息后，这里会出现今天的时间线。</p>
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

      <section className="settings-section">
        <div className="section-head">
          <div>
            <p className="eyebrow">设置</p>
            <h2>提醒节奏</h2>
          </div>
        </div>
        <form className="settings-form" onSubmit={(event) => void saveSettings(event)}>
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
              onChange={(event) =>
                setSettingsDraft((current) => ({ ...current, alwaysOnTop: event.target.checked }))
              }
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
      </section>
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

function clampMinutes(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export default App;
