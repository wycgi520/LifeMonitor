import { formatDuration } from "@lifemonitor/core";
import { percentage } from "../lib/time";

export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
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
