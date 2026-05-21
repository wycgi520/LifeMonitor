import type { LifeSettings } from "@lifemonitor/core";
import type { LogicalSize as TauriLogicalSize } from "@tauri-apps/api/window";
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
  width: 360,
  height: 220,
  minWidth: 320,
  minHeight: 200,
};

const MINI_WINDOW_MARGIN = 16;

const CLOSE_WINDOW_PROMPT =
  "关闭窗口时缩小到系统托盘吗？\n\n确定：缩小到托盘并记住选择\n取消：直接退出并记住选择\n\n之后可在设置里改回每次询问。";

export async function syncPlatformSettings(settings: LifeSettings): Promise<void> {
  if (!isTauriRuntime()) return;

  await Promise.allSettled([
    syncAlwaysOnTop(settings.alwaysOnTop),
    syncAutostart(settings.autostart),
  ]);
}

export async function syncWindowMode(mode: AppWindowMode): Promise<void> {
  if (!isTauriRuntime()) return;

  try {
    const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();

    if (mode === "mini") {
      const miniSize = new LogicalSize(MINI_WINDOW.width, MINI_WINDOW.height);

      await appWindow.setDecorations(false);
      await appWindow.setMinSize(new LogicalSize(MINI_WINDOW.minWidth, MINI_WINDOW.minHeight));
      await appWindow.setMaxSize(null);
      await appWindow.setResizable(true);
      await appWindow.setSize(miniSize);
      await positionMiniWindowAtTopRight(miniSize);
      return;
    }

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

async function positionMiniWindowAtTopRight(size: TauriLogicalSize): Promise<void> {
  const { getCurrentWindow, currentMonitor, primaryMonitor, PhysicalPosition } = await import("@tauri-apps/api/window");
  const appWindow = getCurrentWindow();
  const monitor = (await currentMonitor()) ?? (await primaryMonitor());
  if (!monitor) return;

  const physicalSize = size.toPhysical(monitor.scaleFactor);
  const physicalMargin = Math.round(MINI_WINDOW_MARGIN * monitor.scaleFactor);
  const workArea = monitor.workArea;
  const x = workArea.position.x + workArea.size.width - physicalSize.width - physicalMargin;
  const y = workArea.position.y + physicalMargin;

  await appWindow.setPosition(new PhysicalPosition(Math.max(workArea.position.x, x), y));
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

async function syncAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setAlwaysOnTop(alwaysOnTop);
  } catch (error) {
    console.warn("Failed to sync always-on-top setting.", error);
  }
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
