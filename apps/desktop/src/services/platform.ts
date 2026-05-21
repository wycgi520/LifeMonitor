import type { LifeSettings } from "@lifemonitor/core";
import { isTauriRuntime } from "./repository";

export async function syncPlatformSettings(settings: LifeSettings): Promise<void> {
  if (!isTauriRuntime()) return;

  await Promise.allSettled([
    syncAlwaysOnTop(settings.alwaysOnTop),
    syncAutostart(settings.autostart),
  ]);
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
