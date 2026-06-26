import type { TodayStats } from "@lifemonitor/core";
import type { DonutSegment } from "./metrics";

const donutColors = {
  busy: "#d9982b",
  rest: "#0f837d",
  idle: "#94a3b8",
} as const;

export function getTimeDistributionSegments(stats: TodayStats): DonutSegment[] {
  return [
    { key: "busy", label: "忙碌", value: stats.busySeconds, color: donutColors.busy },
    { key: "rest", label: "休息", value: stats.restSeconds, color: donutColors.rest },
    { key: "idle", label: "空闲", value: stats.idleSeconds, color: donutColors.idle },
  ];
}
