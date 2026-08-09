import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface MigrationFile {
  version: string;
  path: string;
}

function migrationFiles(): readonly MigrationFile[] {
  const directory = fileURLToPath(new URL("./migrations/", import.meta.url));
  return readdirSync(directory)
    .map((name) => ({ name, match: /^(\d+_[A-Za-z0-9_-]+)\.sql$/.exec(name) }))
    .filter((entry): entry is { name: string; match: RegExpExecArray } => entry.match !== null)
    .map((entry) => ({ version: entry.match[1]!, path: fileURLToPath(new URL(`./migrations/${entry.name}`, import.meta.url)) }))
    .sort((left, right) => left.version.localeCompare(right.version));
}

/** Applies each immutable SQL migration exactly once, in lexical version order. */
export function runMigrations(database: Database.Database): void {
  database.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set((database.prepare("SELECT version FROM schema_migrations").all() as { version: string }[]).map((row) => row.version));
  for (const migration of migrationFiles()) {
    if (applied.has(migration.version)) continue;
    const sql = readFileSync(migration.path, "utf8");
    database.transaction(() => {
      database.exec(sql);
      database.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(migration.version, new Date().toISOString());
    })();
  }
}
