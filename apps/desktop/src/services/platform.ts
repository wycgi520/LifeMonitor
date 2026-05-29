import type { LifeSettings } from "@lifemonitor/core";
import type {
  LogicalSize as TauriLogicalSize,
  Monitor as TauriMonitor,
  PhysicalSize as TauriPhysicalSize,
} from "@tauri-apps/api/window";
import { isTauriRuntime } from "./repository";

type SaveSettings = (settings: LifeSettings) => Promise<void>;
export type AppWindowMode = "full" | "mini";
type TauriWindow = {
  destroy(): Promise<void>;
  hide(): Promise<void>;
};

const FULL_WINDOW = {
  width: 1180,
  height: 760,
  minWidth: 960,
  minHeight: 640,
};

const MINI_WINDOW = {
  width: 320,
  height: 92,
  minWidth: 280,
  minHeight: 86,
};

const MINI_WINDOW_MARGIN = 16;
const MINI_WINDOW_POSITION_KEY = "lifemonitor:mini-window-position:v1";

const CLOSE_WINDOW_PROMPT =
  "关闭窗口时缩小到系统托盘吗？\n\n确定：缩小到托盘并记住选择\n取消：直接退出并记住选择\n\n之后可在设置里改回每次询问。";

export async function syncPlatformSettings(settings: LifeSettings): Promise<void> {
  if (!isTauriRuntime()) return;

  await Promise.allSettled([
    syncAlwaysOnTopSetting(settings.alwaysOnTop),
    syncAutostart(settings.autostart),
  ]);
}

export async function syncAlwaysOnTopSetting(alwaysOnTop: boolean): Promise<void> {
  if (!isTauriRuntime()) return;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_window_always_on_top", { alwaysOnTop });
    return;
  } catch (commandError) {
    console.warn("Failed to sync always-on-top setting through Tauri command.", commandError);
  }

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setAlwaysOnTop(alwaysOnTop);
  } catch (windowError) {
    console.warn("Failed to sync always-on-top setting.", windowError);
  }
}

export async function syncWindowMode(mode: AppWindowMode): Promise<void> {
  if (!isTauriRuntime()) return;

  try {
    const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();

    if (mode === "mini") {
      const miniSize = new LogicalSize(MINI_WINDOW.width, MINI_WINDOW.height);

      await appWindow.setSkipTaskbar(true);
      await appWindow.setDecorations(false);
      await appWindow.setMinSize(new LogicalSize(MINI_WINDOW.minWidth, MINI_WINDOW.minHeight));
      await appWindow.setMaxSize(null);
      await appWindow.setResizable(true);
      await appWindow.setSize(miniSize);
      await positionMiniWindow(miniSize);
      return;
    }

    await appWindow.setSkipTaskbar(false);
    await appWindow.setDecorations(true);
    await appWindow.setMaxSize(null);
    await appWindow.setResizable(true);
    await appWindow.setMinSize(new LogicalSize(FULL_WINDOW.minWidth, FULL_WINDOW.minHeight));
    await appWindow.setSize(new LogicalSize(FULL_WINDOW.width, FULL_WINDOW.height));
    await appWindow.center();
  } catch (error) {
    console.warn("Failed to sync window mode.", error);
  }
}

export async function registerMiniWindowPositionTracking(): Promise<() => void> {
  if (!isTauriRuntime()) return () => {};

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();
    return appWindow.onMoved(({ payload }) => {
      saveMiniWindowPosition(payload.x, payload.y);
    });
  } catch (error) {
    console.warn("Failed to track mini window position.", error);
    return () => {};
  }
}

async function positionMiniWindow(size: TauriLogicalSize): Promise<void> {
  const { getCurrentWindow, availableMonitors, currentMonitor, primaryMonitor, PhysicalPosition } = await import(
    "@tauri-apps/api/window"
  );
  const appWindow = getCurrentWindow();
  const monitors = await availableMonitors();
  const fallbackMonitor = (await currentMonitor()) ?? (await primaryMonitor()) ?? monitors[0] ?? null;
  const savedPosition = loadMiniWindowPosition();

  if (savedPosition) {
    const monitor = findMonitorForPosition(savedPosition, monitors) ?? fallbackMonitor;
    if (monitor) {
      const nextPosition = clampPositionToWorkArea(savedPosition, size.toPhysical(monitor.scaleFactor), monitor.workArea);
      await appWindow.setPosition(new PhysicalPosition(nextPosition.x, nextPosition.y));
      saveMiniWindowPosition(nextPosition.x, nextPosition.y);
      return;
    }
  }

  if (!fallbackMonitor) return;

  const nextPosition = getTopRightMiniWindowPosition(size, fallbackMonitor);
  await appWindow.setPosition(new PhysicalPosition(nextPosition.x, nextPosition.y));
  saveMiniWindowPosition(nextPosition.x, nextPosition.y);
}

function getTopRightMiniWindowPosition(size: TauriLogicalSize, monitor: TauriMonitor): { x: number; y: number } {
  const physicalSize = size.toPhysical(monitor.scaleFactor);
  const physicalMargin = Math.round(MINI_WINDOW_MARGIN * monitor.scaleFactor);
  const workArea = monitor.workArea;
  const x = workArea.position.x + workArea.size.width - physicalSize.width - physicalMargin;
  const y = workArea.position.y + physicalMargin;

  return clampPositionToWorkArea({ x, y }, physicalSize, workArea);
}

function findMonitorForPosition(
  position: { x: number; y: number },
  monitors: TauriMonitor[],
): TauriMonitor | null {
  return (
    monitors.find((monitor) => {
      const workArea = monitor.workArea;
      const left = workArea.position.x;
      const top = workArea.position.y;
      const right = left + workArea.size.width;
      const bottom = top + workArea.size.height;
      return position.x >= left && position.x < right && position.y >= top && position.y < bottom;
    }) ?? null
  );
}

function clampPositionToWorkArea(
  position: { x: number; y: number },
  size: TauriPhysicalSize,
  workArea: TauriMonitor["workArea"],
): { x: number; y: number } {
  const minX = workArea.position.x;
  const minY = workArea.position.y;
  const maxX = Math.max(minX, workArea.position.x + workArea.size.width - size.width);
  const maxY = Math.max(minY, workArea.position.y + workArea.size.height - size.height);

  return {
    x: Math.round(clamp(position.x, minX, maxX)),
    y: Math.round(clamp(position.y, minY, maxY)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function loadMiniWindowPosition(): { x: number; y: number } | null {
  const raw = window.localStorage.getItem(MINI_WINDOW_POSITION_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<{ x: number; y: number }>;
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return null;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return { x: Math.round(parsed.x), y: Math.round(parsed.y) };
  } catch {
    return null;
  }
}

function saveMiniWindowPosition(x: number, y: number): void {
  window.localStorage.setItem(MINI_WINDOW_POSITION_KEY, JSON.stringify({ x: Math.round(x), y: Math.round(y) }));
}

export async function startWindowDrag(): Promise<void> {
  if (!isTauriRuntime()) return;

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().startDragging();
  } catch (error) {
    console.warn("Failed to start window drag.", error);
  }
}

export async function startWindowResize(): Promise<void> {
  if (!isTauriRuntime()) return;

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().startResizeDragging("SouthEast");
  } catch (error) {
    console.warn("Failed to start window resize.", error);
  }
}

export async function registerWindowCloseBehavior(
  settings: LifeSettings,
  saveSettings: SaveSettings,
): Promise<() => void> {
  if (!isTauriRuntime()) return () => {};

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const appWindow = getCurrentWindow();

  return appWindow.onCloseRequested(async (event) => {
    if (settings.closeWindowBehavior === "minimize-to-tray") {
      event.preventDefault();
      await appWindow.hide();
      return;
    }

    if (settings.closeWindowBehavior === "quit") {
      event.preventDefault();
      await quitApplication(appWindow);
      return;
    }

    event.preventDefault();
    const shouldMinimize = window.confirm(CLOSE_WINDOW_PROMPT);
    const nextSettings: LifeSettings = {
      ...settings,
      closeWindowBehavior: shouldMinimize ? "minimize-to-tray" : "quit",
    };

    try {
      await saveSettings(nextSettings);
    } catch (error) {
      console.warn("Failed to save close-window behavior.", error);
    }

    if (shouldMinimize) {
      await appWindow.hide();
      return;
    }

    await quitApplication(appWindow);
  });
}

async function syncAutostart(enabled: boolean): Promise<void> {
  try {
    const autostart = await import("@tauri-apps/plugin-autostart");
    if (enabled) {
      await autostart.enable();
    } else {
      await autostart.disable();
    }
  } catch (error) {
    console.warn("Failed to sync autostart setting.", error);
  }
}

async function quitApplication(appWindow: TauriWindow): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("quit_app");
  } catch (error) {
    console.warn("Failed to quit app through Tauri command, closing window instead.", error);
    await appWindow.destroy();
  }
}
