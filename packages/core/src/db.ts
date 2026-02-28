import fs from "node:fs/promises";
import path from "node:path";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import type {
  ArtifactKind,
  Mode,
  Role,
  Source
} from "@the-architect/shared-types";

export type AppDatabase = Database;

export type SessionRecord = {
  id: string;
  title: string | null;
  mode: Mode;
  created_at: string;
  updated_at: string;
};

export type MessageRecord = {
  id: string;
  session_id: string;
  role: Role;
  content: string;
  transcript_source: Source;
  created_at: string;
};

export type ArtifactRecord = {
  id: string;
  session_id: string;
  kind: ArtifactKind;
  title: string;
  content_md: string;
  content_json: string;
  created_at: string;
};

export type CreateSessionInput = {
  id: string;
  mode: Mode;
  title?: string | undefined;
};

export type InsertMessageInput = {
  id: string;
  session_id: string;
  role: Role;
  content: string;
  transcript_source: Source;
};

export type CreateArtifactInput = {
  id: string;
  session_id: string;
  kind: ArtifactKind;
  title: string;
  content_md: string;
  content_json: string;
};

function normalizeDatabasePath(databaseUrl: string): string {
  if (databaseUrl === ":memory:") {
    return databaseUrl;
  }

  if (databaseUrl.startsWith("sqlite://")) {
    return databaseUrl.slice("sqlite://".length);
  }

  if (databaseUrl.startsWith("file:")) {
    return databaseUrl.slice("file:".length);
  }

  return databaseUrl;
}

async function ensureParentDirectory(dbPath: string) {
  if (dbPath === ":memory:") {
    return;
  }

  const parent = path.dirname(dbPath);
  await fs.mkdir(parent, { recursive: true });
}

export async function openDatabase(databaseUrl: string): Promise<AppDatabase> {
  const dbPath = normalizeDatabasePath(databaseUrl);
  await ensureParentDirectory(dbPath);

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  await db.exec("PRAGMA journal_mode = WAL;");
  await db.exec("PRAGMA foreign_keys = ON;");

  return db;
}

export async function runMigrations(db: AppDatabase): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT,
      mode TEXT NOT NULL CHECK (mode IN ('architect', 'planner', 'pitch')),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      transcript_source TEXT NOT NULL CHECK (transcript_source IN ('voice', 'text')),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('architecture', 'tasks', 'pitch')),
      title TEXT NOT NULL,
      content_md TEXT NOT NULL,
      content_json TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'completed', 'failed')),
      error TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_artifacts_session_id ON artifacts(session_id);
  `);

  await ensureColumnExists(db, "artifacts", "content_json", "TEXT");
}

async function ensureColumnExists(
  db: AppDatabase,
  tableName: string,
  columnName: string,
  columnDefinition: string
) {
  const rows = await db.all<{ name: string }[]>(
    `PRAGMA table_info(${tableName});`
  );

  if (rows.some((row) => row.name === columnName)) {
    return;
  }

  await db.exec(
    `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition};`
  );
}

export async function createSession(
  db: AppDatabase,
  input: CreateSessionInput
): Promise<SessionRecord> {
  await db.run(
    `INSERT INTO sessions (id, title, mode, created_at, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    input.id,
    input.title ?? null,
    input.mode
  );

  const row = await getSessionById(db, input.id);

  if (!row) {
    throw new Error("Failed to fetch created session");
  }

  return row;
}

export async function ensureSessionExists(
  db: AppDatabase,
  input: CreateSessionInput
): Promise<void> {
  const existing = await getSessionById(db, input.id);

  if (existing) {
    return;
  }

  await createSession(db, input);
}

export async function getSessionById(
  db: AppDatabase,
  sessionId: string
): Promise<SessionRecord | undefined> {
  return db.get<SessionRecord>(
    `SELECT id, title, mode, created_at, updated_at
     FROM sessions
     WHERE id = ?`,
    sessionId
  );
}

export async function insertMessage(
  db: AppDatabase,
  input: InsertMessageInput
): Promise<void> {
  await db.run(
    `INSERT INTO messages (id, session_id, role, content, transcript_source, created_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    input.id,
    input.session_id,
    input.role,
    input.content,
    input.transcript_source
  );
}

export async function listArtifactsBySession(
  db: AppDatabase,
  sessionId: string
): Promise<ArtifactRecord[]> {
  return db.all<ArtifactRecord[]>(
    `SELECT id, session_id, kind, title, content_md, content_json, created_at
     FROM artifacts
     WHERE session_id = ?
     ORDER BY created_at DESC`,
    sessionId
  );
}

export async function getArtifactById(
  db: AppDatabase,
  artifactId: string
): Promise<ArtifactRecord | undefined> {
  return db.get<ArtifactRecord>(
    `SELECT id, session_id, kind, title, content_md, content_json, created_at
     FROM artifacts
     WHERE id = ?`,
    artifactId
  );
}

export async function insertArtifact(
  db: AppDatabase,
  input: CreateArtifactInput
): Promise<void> {
  await db.run(
    `INSERT INTO artifacts (id, session_id, kind, title, content_md, content_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    input.id,
    input.session_id,
    input.kind,
    input.title,
    input.content_md,
    input.content_json
  );
}

export async function upsertJobStatus(
  db: AppDatabase,
  input: {
    id: string;
    session_id: string;
    kind: string;
    status: "pending" | "active" | "completed" | "failed";
    error?: string | null;
  }
): Promise<void> {
  await db.run(
    `INSERT INTO jobs (id, session_id, kind, status, error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        error = excluded.error,
        updated_at = CURRENT_TIMESTAMP`,
    input.id,
    input.session_id,
    input.kind,
    input.status,
    input.error ?? null
  );
}
