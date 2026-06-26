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
  icon,
  accent,
  hint,
}: {
  label: string;
  value: string;
  tone?: "warning";
  icon?: ReactNode;
  accent?: boolean;
  hint?: string;
}) {
  return (
    <div
      className={`metric ${tone === "warning" ? "warning-metric" : ""} ${accent ? "accent-metric" : ""}`}
      title={hint}
    >
      <span>
        {icon && <span className="metric-icon">{icon}</span>}
        {label}
      </span>
      <strong>{value}</strong>
      {hint && <small className="metric-hint">{hint}</small>}
    </div>
  );
}

export function CompareBars({
  title,
  items,
}: {
  title: string;
  items: Array<{ key: string; label: string; value: number }>;
}) {
  const max = Math.max(...items.map((item) => item.value), 0);

  return (
    <div className="compare-bars">
      <span className="compare-bars-title">{title}</span>
      <div className="compare-bars-list">
        {items.map((item) => (
          <div key={item.key} className="compare-bar-row">
            <span className="compare-bar-label">{item.label}</span>
            <div className="progress-track compare-bar-track">
              <div
                className={`progress-bar ${item.key}`}
                style={{ width: `${max > 0 ? (item.value / max) * 100 : 0}%` }}
              />
            </div>
            <strong className="compare-bar-value">{formatDuration(item.value)}</strong>
          </div>
        ))}
      </div>
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
