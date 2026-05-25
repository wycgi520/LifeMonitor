# LifeMonitor

LifeMonitor is a local-first desktop reminder and activity timeline tool. It tracks busy/rest periods, automatically returns to idle when a timer ends, supports quick task switching, manual backfill, and JSON import/export for moving records between devices.

## Architecture

- `apps/desktop`: Tauri v2 + React desktop application.
- `packages/core`: pure TypeScript timer, timeline, and statistics logic shared by future web/mobile apps.
- Desktop storage uses SQLite through the Tauri SQL plugin.
- Browser/dev storage falls back to localStorage so the React app can later become a PWA with a storage adapter swap.

## Commands

- `npm run dev`: start the React dev server.
- `npm run desktop`: start the Tauri app in development.
- `npm run test`: run core unit tests.
- `npm run build`: build core and the React frontend.
- `npm run tauri:build -w @lifemonitor/desktop`: build the desktop executable and Windows installers.
