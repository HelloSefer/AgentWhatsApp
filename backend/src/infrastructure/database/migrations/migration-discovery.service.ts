import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DuplicateMigrationIdentifierError, DatabaseMigrationError } from "../errors/database.errors";
import type { DatabaseMigration } from "./migration.types";

const MIGRATION_FILENAME = /^(\d{4,})[_-]([a-z0-9][a-z0-9_-]*)\.sql$/iu;

export function getDefaultMigrationDirectory(): string {
  const compiledDirectory = path.resolve(__dirname, "sql");
  const sourceDirectory = path.resolve(process.cwd(), "src", "infrastructure", "database", "migrations", "sql");
  return existsSync(compiledDirectory) ? compiledDirectory : sourceDirectory;
}

export async function discoverDatabaseMigrations(directory = getDefaultMigrationDirectory()): Promise<readonly DatabaseMigration[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return [];
    throw new DatabaseMigrationError(error);
  }

  const migrations: DatabaseMigration[] = [];
  const identifiers = new Set<string>();
  for (const filename of entries.sort((left: string, right: string) => left.localeCompare(right))) {
    if (!filename.toLowerCase().endsWith(".sql")) continue;
    const match = filename.match(MIGRATION_FILENAME);
    if (!match) throw new DatabaseMigrationError();
    const id = match[1];
    if (identifiers.has(id)) throw new DuplicateMigrationIdentifierError();
    identifiers.add(id);
    const migrationPath = path.join(directory, filename);
    try {
      migrations.push({ id, filename, path: migrationPath, sql: await readFile(migrationPath, "utf8") });
    } catch (error) {
      throw new DatabaseMigrationError(error);
    }
  }

  return migrations.sort((left, right) => left.filename.localeCompare(right.filename));
}
