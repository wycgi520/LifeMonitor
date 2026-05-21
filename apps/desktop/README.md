# LifeMonitor Desktop

Tauri + React desktop shell for LifeMonitor.

## Scripts

- `npm run dev -w @lifemonitor/desktop` starts the browser dev server.
- `npm run tauri:dev -w @lifemonitor/desktop` starts the Tauri desktop app.
- `npm run tauri:build -w @lifemonitor/desktop` builds the executable and Windows installers.

Runtime storage uses Tauri SQLite in the desktop app and falls back to localStorage when opened as a regular web page.
