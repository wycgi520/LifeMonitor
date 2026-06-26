import type { ReactNode } from "react";
import { formatDuration } from "@lifemonitor/core";
import { percentage } from "../lib/time";

export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warning";
}) {
  return (
    <div className={`metric ${tone === "warning" ? "warning-metric" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function TargetRing({
  ratio,
  label = "本段",
}: {
  ratio: number;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const percent = Math.round(clamped * 100);
  const sweep = `${clamped * 100}%`;

  return (
    <div
      className="target-ring"
      style={{ background: `conic-gradient(var(--accent) 0 ${sweep}, var(--border) ${sweep} 100%)` }}
      role="img"
      aria-label={`${label}完成进度 ${percent}%`}
    >
      <span>
        <span className="target-ring-value">{percent}%</span>
        <span className="target-ring-label">{label}</span>
      </span>
    </div>
  );
}

export function DayRuler({ segments }: { segments: DonutSegment[] }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const visible = segments.filter((segment) => segment.value > 0);

  return (
    <div>
      <div className="day-ruler" role="img" aria-label="当天时间分布">
        {total > 0 &&
          visible.map((segment) => (
            <span
              key={segment.key}
              className={`day-ruler-seg ${segment.key}`}
              style={{ width: `${(segment.value / total) * 100}%` }}
            />
          ))}
      </div>
      <div className="day-ruler-legend">
        {segments.map((segment) => (
          <span key={segment.key} className="legend-item">
            <i className={`legend-dot ${segment.key}`} aria-hidden="true" />
            {segment.label} {formatDuration(segment.value)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function StateFeedback({
  tone = "default",
  title,
  children,
  action,
  live,
}: {
  tone?: "default" | "success" | "warning" | "error" | "loading";
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  live?: "polite" | "assertive";
}) {
  const toneClass = tone === "default" ? "" : `${tone}-state`;
  const role = tone === "error" ? "alert" : tone === "loading" ? "status" : undefined;

  return (
    <div className={`state-feedback ${toneClass}`} role={role} aria-live={live}>
      <strong>{title}</strong>
      {children && <span>{children}</span>}
      {action && <div className="feedback-action">{action}</div>}
    </div>
  );
}

export function DonutChart({
  title,
  segments,
  compact = false,
}: {
  title: string;
  segments: DonutSegment[];
  compact?: boolean;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const visibleSegments = segments.filter((segment) => segment.value > 0);
  let cursor = 0;
  const gradient =
    total > 0
      ? `conic-gradient(${visibleSegments
          .map((segment) => {
            const start = cursor;
            const end = cursor + (segment.value / total) * 100;
            cursor = end;
            return `${segment.color} ${start}% ${end}%`;
          })
          .join(", ")})`
      : "conic-gradient(#e8eef0 0% 100%)";

  return (
    <div className={`donut-card ${compact ? "compact" : ""}`}>
      <div className="donut-visual" style={{ background: gradient }} aria-hidden="true">
        <div className="donut-hole">
          <strong>{total > 0 ? formatDuration(total) : "0秒"}</strong>
          <span>合计</span>
        </div>
      </div>
      <div className="donut-meta">
        <h3>{title}</h3>
        <div className="donut-legend">
          {segments.map((segment) => {
            const ratio = percentage(segment.value, total);
            return (
              <div key={segment.key} className="donut-legend-row">
                <span className="donut-swatch" style={{ backgroundColor: segment.color }} />
                <span>{segment.label}</span>
                <strong>{formatDuration(segment.value)}</strong>
                <em>{ratio}%</em>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function TaskStatsList({
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
