import type { LifeSettings } from "@lifemonitor/core";
import { isTauriRuntime } from "./repository";

type SaveSettings = (settings: LifeSettings) => Promise<void>;
type TauriWindow = {
  destroy(): Promise<void>;
  hide(): Promise<void>;
};

const CLOSE_WINDOW_PROMPT =
  "关闭窗口时缩小到系统托盘吗？\n\n确定：缩小到托盘并记住选择\n取消：直接退出并记住选择\n\n之后可在设置里改回每次询问。";

export async function syncPlatformSettings(settings: LifeSettings): Promise<void> {
  if (!isTauriRuntime()) return;

  await Promise.allSettled([
    syncAlwaysOnTop(settings.alwaysOnTop),
    syncAutostart(settings.autostart),
  ]);
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
