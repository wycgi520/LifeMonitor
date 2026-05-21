import {
  DEFAULT_SETTINGS,
  type LifeSettings,
  type TimelineSegment,
} from "@lifemonitor/core";

export interface LifeRepository {
  loadSettings(): Promise<LifeSettings>;
  saveSettings(settings: LifeSettings): Promise<void>;
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

  async listSegments(startIso: string, endIso: string): Promise<TimelineSegment[]> {
    return this.read()
      .segments.filter((segment) => {
        const segmentEnd = segment.endedAt ?? new Date().toISOString();
        return segment.startedAt < endIso && segmentEnd > startIso;
      })
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
    };

    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;

    try {
      const parsed = JSON.parse(raw) as Partial<StoredData>;
      return {
        settings: {
          ...DEFAULT_SETTINGS,
          ...parsed.settings,
        },
        segments: parsed.segments ?? [],
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

    return {
      ...DEFAULT_SETTINGS,
      ...(JSON.parse(rows[0].value) as Partial<LifeSettings>),
    };
  }

  async saveSettings(settings: LifeSettings): Promise<void> {
    await this.db.execute(
      "INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      ["main", JSON.stringify(settings), new Date().toISOString()],
    );
  }

  async listSegments(startIso: string, endIso: string): Promise<TimelineSegment[]> {
    const rows = await this.db.select<SegmentRow[]>(
      "SELECT * FROM timeline_segments WHERE started_at < $1 AND COALESCE(ended_at, $2) > $3 ORDER BY started_at ASC",
      [endIso, new Date().toISOString(), startIso],
    );
    return rows.map(rowToSegment);
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
        id, state_run_id, state, task_name, started_at, ended_at,
        planned_end_at, created_at, updated_at, is_edited
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      segmentToParams(segment),
    );
  }

  async updateSegment(segment: TimelineSegment): Promise<void> {
    await this.db.execute(
      `UPDATE timeline_segments
        SET state_run_id = $2,
            state = $3,
            task_name = $4,
            started_at = $5,
            ended_at = $6,
            planned_end_at = $7,
            created_at = $8,
            updated_at = $9,
            is_edited = $10
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
        started_at TEXT NOT NULL,
        ended_at TEXT,
        planned_end_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        is_edited INTEGER NOT NULL DEFAULT 0
      )
    `);
    await this.db.execute("CREATE INDEX IF NOT EXISTS idx_timeline_time ON timeline_segments (started_at, ended_at)");
    await this.db.execute("CREATE INDEX IF NOT EXISTS idx_timeline_run ON timeline_segments (state_run_id)");
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
  started_at: string;
  ended_at: string | null;
  planned_end_at: string;
  created_at: string;
  updated_at: string;
  is_edited: number;
}

function rowToSegment(row: SegmentRow): TimelineSegment {
  return {
    id: row.id,
    stateRunId: row.state_run_id,
    state: row.state,
    taskName: row.task_name,
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
    segment.startedAt,
    segment.endedAt,
    segment.plannedEndAt,
    segment.createdAt,
    segment.updatedAt,
    segment.isEdited ? 1 : 0,
  ];
}
