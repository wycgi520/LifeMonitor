import {
  buildLifeDataExport,
  DEFAULT_SETTINGS,
  normalizeTaskName,
  type LifeSettings,
  type LifeDataExport,
  type SummaryEntry,
  type SummaryScope,
  type TimelineSegment,
  type TrackableState,
} from "@lifemonitor/core";
import { timelineIntervalsOverlap } from "../lib/time";

export interface LifeRepository {
  loadSettings(): Promise<LifeSettings>;
  saveSettings(settings: LifeSettings): Promise<void>;
  getLatestTaskName(state: TrackableState): Promise<string | null>;
  exportData(): Promise<LifeDataExport>;
  replaceData(data: LifeDataExport): Promise<void>;
  loadSummary(scope: SummaryScope, key: string): Promise<SummaryEntry | null>;
  saveSummary(summary: SummaryEntry): Promise<void>;
  listSegments(startIso: string, endIso: string): Promise<TimelineSegment[]>;
  getOpenSegment(): Promise<TimelineSegment | null>;
  insertSegment(segment: TimelineSegment): Promise<void>;
  updateSegment(segment: TimelineSegment): Promise<void>;
  updateRunPlannedEnd(stateRunId: string, plannedEndAt: string, updatedAt: string): Promise<void>;
  deleteSegment(id: string): Promise<void>;
}

interface StoredData {
  settings: LifeSettings;
  segments: TimelineSegment[];
  summaries: SummaryEntry[];
}

const STORAGE_KEY = "lifemonitor:data:v1";

export async function createRepository(): Promise<LifeRepository> {
  if (isTauriRuntime()) {
    try {
      return await TauriSqlRepository.create();
    } catch (error) {
      console.warn("SQLite repository unavailable, falling back to localStorage.", error);
    }
  }

  return new LocalStorageRepository();
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

class LocalStorageRepository implements LifeRepository {
  async loadSettings(): Promise<LifeSettings> {
    return this.read().settings;
  }

  async saveSettings(settings: LifeSettings): Promise<void> {
    const data = this.read();
    data.settings = settings;
    this.write(data);
  }

  async getLatestTaskName(state: TrackableState): Promise<string | null> {
    const latest = [...this.read().segments]
      .filter((segment) => segment.state === state && normalizeTaskName(segment.taskName))
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];

    return normalizeTaskName(latest?.taskName);
  }

  async exportData(): Promise<LifeDataExport> {
    return buildLifeDataExport({ ...this.read(), exportedAt: new Date().toISOString() });
  }

  async replaceData(data: LifeDataExport): Promise<void> {
    this.write({
      settings: data.settings,
      segments: data.segments,
      summaries: data.summaries,
    });
  }

  async loadSummary(scope: SummaryScope, key: string): Promise<SummaryEntry | null> {
    return this.read().summaries.find((summary) => summary.scope === scope && summary.key === key) ?? null;
  }

  async saveSummary(summary: SummaryEntry): Promise<void> {
    const data = this.read();
    const normalizedSummary = buildLifeDataExport({
      settings: data.settings,
      segments: [],
      summaries: [summary],
      exportedAt: new Date().toISOString(),
    }).summaries[0];

    data.summaries = [
      ...data.summaries.filter((item) => item.scope !== summary.scope || item.key !== summary.key),
      normalizedSummary,
    ];
    this.write(data);
  }

  async listSegments(startIso: string, endIso: string): Promise<TimelineSegment[]> {
    return this.read()
      .segments.filter((segment) => timelineIntervalsOverlap(segment, { startedAt: startIso, endedAt: endIso }))
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  }

  async getOpenSegment(): Promise<TimelineSegment | null> {
    return this.read().segments.find((segment) => segment.endedAt === null) ?? null;
  }

  async insertSegment(segment: TimelineSegment): Promise<void> {
    const data = this.read();
    data.segments.push(segment);
    this.write(data);
  }

  async updateSegment(segment: TimelineSegment): Promise<void> {
    const data = this.read();
    data.segments = data.segments.map((item) => (item.id === segment.id ? segment : item));
    this.write(data);
  }

  async updateRunPlannedEnd(stateRunId: string, plannedEndAt: string, updatedAt: string): Promise<void> {
    const data = this.read();
    data.segments = data.segments.map((segment) =>
      segment.stateRunId === stateRunId
        ? {
            ...segment,
            plannedEndAt,
            updatedAt,
          }
        : segment,
    );
    this.write(data);
  }

  async deleteSegment(id: string): Promise<void> {
    const data = this.read();
    data.segments = data.segments.filter((segment) => segment.id !== id);
    this.write(data);
  }

  private read(): StoredData {
    const fallback: StoredData = {
      settings: DEFAULT_SETTINGS,
      segments: [],
      summaries: [],
    };

    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;

    try {
      const parsed = JSON.parse(raw) as Partial<StoredData>;
      const normalized = buildLifeDataExport({
        settings: parsed.settings,
        segments: Array.isArray(parsed.segments) ? parsed.segments : [],
        summaries: Array.isArray(parsed.summaries) ? parsed.summaries : [],
        exportedAt: new Date().toISOString(),
      });
      return {
        settings: normalized.settings,
        segments: normalized.segments,
        summaries: normalized.summaries,
      };
    } catch {
      return fallback;
    }
  }

  private write(data: StoredData): void {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }
}

class TauriSqlRepository implements LifeRepository {
  private readonly db: SqlDatabase;

  private constructor(db: SqlDatabase) {
    this.db = db;
  }

  static async create(): Promise<TauriSqlRepository> {
    const { default: Database } = await import("@tauri-apps/plugin-sql");
    const db = await Database.load("sqlite:lifemonitor.db");
    const repository = new TauriSqlRepository(db as SqlDatabase);
    await repository.migrate();
    return repository;
  }

  async loadSettings(): Promise<LifeSettings> {
    const rows = await this.db.select<Array<{ value: string }>>("SELECT value FROM settings WHERE key = $1", ["main"]);
    if (rows.length === 0) return DEFAULT_SETTINGS;

    return buildLifeDataExport({
      settings: JSON.parse(rows[0].value),
      segments: [],
      summaries: [],
      exportedAt: new Date().toISOString(),
    }).settings;
  }

  async saveSettings(settings: LifeSettings): Promise<void> {
    await this.db.execute(
      "INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      ["main", JSON.stringify(settings), new Date().toISOString()],
    );
  }

  async getLatestTaskName(state: TrackableState): Promise<string | null> {
    const rows = await this.db.select<Array<{ task_name: string }>>(
      "SELECT task_name FROM timeline_segments WHERE state = $1 AND task_name IS NOT NULL AND TRIM(task_name) <> '' ORDER BY started_at DESC LIMIT 1",
      [state],
    );

    return normalizeTaskName(rows[0]?.task_name);
  }

  async exportData(): Promise<LifeDataExport> {
    const rows = await this.db.select<SegmentRow[]>("SELECT * FROM timeline_segments ORDER BY started_at ASC");
    return buildLifeDataExport({
      settings: await this.loadSettings(),
      segments: rows.map(rowToSegment),
      summaries: await this.listSummaries(),
      exportedAt: new Date().toISOString(),
    });
  }

  async replaceData(data: LifeDataExport): Promise<void> {
    await this.db.execute("BEGIN TRANSACTION");

    try {
      await this.db.execute("DELETE FROM timeline_segments");
      await this.db.execute("DELETE FROM summaries");
      await this.db.execute("DELETE FROM settings");
      await this.saveSettings(data.settings);
      for (const segment of data.segments) {
        await this.insertSegment(segment);
      }
      for (const summary of data.summaries) {
        await this.saveSummary(summary);
      }
      await this.db.execute("COMMIT");
    } catch (error) {
      try {
        await this.db.execute("ROLLBACK");
      } catch (rollbackError) {
        console.warn("Failed to roll back imported LifeMonitor data.", rollbackError);
      }
      throw error;
    }
  }

  async listSegments(startIso: string, endIso: string): Promise<TimelineSegment[]> {
    const rows = await this.db.select<SegmentRow[]>(
      "SELECT * FROM timeline_segments WHERE started_at < $1 AND COALESCE(ended_at, $2) > $3 ORDER BY started_at ASC",
      [endIso, new Date().toISOString(), startIso],
    );
    return rows.map(rowToSegment);
  }

  async loadSummary(scope: SummaryScope, key: string): Promise<SummaryEntry | null> {
    const rows = await this.db.select<SummaryRow[]>(
      "SELECT * FROM summaries WHERE scope = $1 AND summary_key = $2 LIMIT 1",
      [scope, key],
    );
    return rows[0] ? rowToSummary(rows[0]) : null;
  }

  async saveSummary(summary: SummaryEntry): Promise<void> {
    const normalizedSummary = buildLifeDataExport({
      settings: DEFAULT_SETTINGS,
      segments: [],
      summaries: [summary],
      exportedAt: new Date().toISOString(),
    }).summaries[0];

    await this.db.execute(
      `INSERT INTO summaries (scope, summary_key, content, updated_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT(scope, summary_key)
        DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
      summaryToParams(normalizedSummary),
    );
  }

  async getOpenSegment(): Promise<TimelineSegment | null> {
    const rows = await this.db.select<SegmentRow[]>(
      "SELECT * FROM timeline_segments WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1",
    );
    return rows[0] ? rowToSegment(rows[0]) : null;
  }

  async insertSegment(segment: TimelineSegment): Promise<void> {
    await this.db.execute(
      `INSERT INTO timeline_segments (
        id, state_run_id, state, task_name, note, started_at, ended_at,
        planned_end_at, created_at, updated_at, is_edited
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      segmentToParams(segment),
    );
  }

  async updateSegment(segment: TimelineSegment): Promise<void> {
    await this.db.execute(
      `UPDATE timeline_segments
        SET state_run_id = $2,
            state = $3,
            task_name = $4,
            note = $5,
            started_at = $6,
            ended_at = $7,
            planned_end_at = $8,
            created_at = $9,
            updated_at = $10,
            is_edited = $11
        WHERE id = $1`,
      segmentToParams(segment),
    );
  }

  async updateRunPlannedEnd(stateRunId: string, plannedEndAt: string, updatedAt: string): Promise<void> {
    await this.db.execute(
      "UPDATE timeline_segments SET planned_end_at = $1, updated_at = $2 WHERE state_run_id = $3",
      [plannedEndAt, updatedAt, stateRunId],
    );
  }

  async deleteSegment(id: string): Promise<void> {
    await this.db.execute("DELETE FROM timeline_segments WHERE id = $1", [id]);
  }

  private async migrate(): Promise<void> {
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS timeline_segments (
        id TEXT PRIMARY KEY,
        state_run_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('busy', 'rest')),
        task_name TEXT,
        note TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        planned_end_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        is_edited INTEGER NOT NULL DEFAULT 0
      )
    `);
    await this.ensureColumn("timeline_segments", "note", "TEXT");
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS summaries (
        scope TEXT NOT NULL CHECK (scope IN ('day', 'week')),
        summary_key TEXT NOT NULL,
        content TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope, summary_key)
      )
    `);
    await this.db.execute("CREATE INDEX IF NOT EXISTS idx_timeline_time ON timeline_segments (started_at, ended_at)");
    await this.db.execute("CREATE INDEX IF NOT EXISTS idx_timeline_run ON timeline_segments (state_run_id)");
  }

  private async ensureColumn(tableName: string, columnName: string, definition: string): Promise<void> {
    const columns = await this.db.select<Array<{ name: string }>>(`PRAGMA table_info(${tableName})`);
    if (columns.some((column) => column.name === columnName)) return;
    await this.db.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }

  private async listSummaries(): Promise<SummaryEntry[]> {
    const rows = await this.db.select<SummaryRow[]>("SELECT * FROM summaries ORDER BY scope ASC, summary_key ASC");
    return rows.map(rowToSummary);
  }
}

interface SqlDatabase {
  execute(query: string, bindValues?: unknown[]): Promise<unknown>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
}

interface SegmentRow {
  id: string;
  state_run_id: string;
  state: "busy" | "rest";
  task_name: string | null;
  note: string | null;
  started_at: string;
  ended_at: string | null;
  planned_end_at: string;
  created_at: string;
  updated_at: string;
  is_edited: number;
}

interface SummaryRow {
  scope: SummaryScope;
  summary_key: string;
  content: string;
  updated_at: string;
}

function rowToSegment(row: SegmentRow): TimelineSegment {
  return {
    id: row.id,
    stateRunId: row.state_run_id,
    state: row.state,
    taskName: row.task_name,
    note: row.note ?? null,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    plannedEndAt: row.planned_end_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isEdited: Boolean(row.is_edited),
  };
}

function segmentToParams(segment: TimelineSegment): unknown[] {
  return [
    segment.id,
    segment.stateRunId,
    segment.state,
    segment.taskName,
    segment.note,
    segment.startedAt,
    segment.endedAt,
    segment.plannedEndAt,
    segment.createdAt,
    segment.updatedAt,
    segment.isEdited ? 1 : 0,
  ];
}

function rowToSummary(row: SummaryRow): SummaryEntry {
  return {
    scope: row.scope,
    key: row.summary_key,
    content: row.content,
    updatedAt: row.updated_at,
  };
}

function summaryToParams(summary: SummaryEntry): unknown[] {
  return [summary.scope, summary.key, summary.content, summary.updatedAt];
}
