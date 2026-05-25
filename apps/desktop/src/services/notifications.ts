import type { LifeSettings, TimerSnapshot } from "@lifemonitor/core";
import { formatDuration } from "@lifemonitor/core";
import { isTauriRuntime } from "./repository";

export async function showReminderNotification(snapshot: TimerSnapshot, settings: LifeSettings): Promise<void> {
  const stateText = snapshot.state === "busy" ? "忙碌" : "休息";
  const body = `${stateText}到点了，已自动回到空闲。原计划 ${formatDuration(snapshot.targetMinutes * 60)}。`;

  if (isTauriRuntime()) {
    try {
      const notification = await import("@tauri-apps/plugin-notification");
      let permissionGranted = await notification.isPermissionGranted();
      if (!permissionGranted) {
        permissionGranted = (await notification.requestPermission()) === "granted";
      }
      if (permissionGranted) {
        notification.sendNotification({
          title: "LifeMonitor 提醒",
          body,
        });
      }
    } catch (error) {
      console.warn("Tauri notification failed.", error);
    }
  } else if ("Notification" in window) {
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission === "granted") {
      new Notification("LifeMonitor 提醒", { body });
    }
  }

  if (settings.soundEnabled) {
    playReminderTone();
  }
}

function playReminderTone(): void {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) return;

  const context = new AudioContextConstructor();
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.value = 620;
  gain.gain.setValueAtTime(0.001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.1, context.currentTime + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.45);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.5);
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
