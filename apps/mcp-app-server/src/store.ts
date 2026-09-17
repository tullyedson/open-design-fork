import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  emptyDesign,
  normalizeDesign,
  type Design,
  type SavedDesign,
} from "@open-design/contracts/mcp-design";

/** Standalone storage. No host application, account, filesystem project or cloud dependency. */
export class DesignStore {
  private readonly db: DatabaseSync;

  constructor(database: string) {
    this.db = new DatabaseSync(database);
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS designs (id TEXT PRIMARY KEY, snapshot TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS versions (
        sequence INTEGER PRIMARY KEY, id TEXT NOT NULL, revision TEXT NOT NULL UNIQUE, snapshot TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS versions_by_design ON versions(id, sequence);
    `);
  }

  close() {
    this.db.close();
  }

  private transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private snapshot(id: string, title: string, design: Design): SavedDesign {
    const cleanTitle = title.trim();
    if (
      !cleanTitle ||
      cleanTitle.length > 160 ||
      /[\x00-\x1f]/.test(cleanTitle)
    ) {
      throw new Error(
        "A design title must contain 1–160 printable characters.",
      );
    }
    return {
      id,
      title: cleanTitle,
      revision: randomUUID(),
      savedAt: new Date().toISOString(),
      design: normalizeDesign(design),
    };
  }

  private persist(saved: SavedDesign) {
    const snapshot = JSON.stringify(saved);
    this.db
      .prepare(
        "INSERT INTO designs(id, snapshot) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET snapshot = excluded.snapshot",
      )
      .run(saved.id, snapshot);
    this.db
      .prepare("INSERT INTO versions(id, revision, snapshot) VALUES (?, ?, ?)")
      .run(saved.id, saved.revision, snapshot);
    // Bound growth per design while preserving a useful restore history.
    this.db
      .prepare(
        "DELETE FROM versions WHERE id = ? AND sequence NOT IN (SELECT sequence FROM versions WHERE id = ? ORDER BY sequence DESC LIMIT 100)",
      )
      .run(saved.id, saved.id);
    return saved;
  }

  create(title: string, design: Design = emptyDesign()) {
    return this.transaction(() =>
      this.persist(this.snapshot(randomUUID(), title, design)),
    );
  }

  read(id: string): SavedDesign {
    const row = this.db
      .prepare("SELECT snapshot FROM designs WHERE id = ?")
      .get(id);
    if (!row)
      throw new Error("Design not found. Use open_design_list to find its ID.");
    return JSON.parse(String(row.snapshot)) as SavedDesign;
  }

  list(limit = 100, offset = 0) {
    const rows = this.db
      .prepare(
        "SELECT snapshot FROM designs ORDER BY rowid DESC LIMIT ? OFFSET ?",
      )
      .all(limit, offset);
    return rows.map((row) => {
      const { id, title, revision, savedAt } = JSON.parse(
        String(row.snapshot),
      ) as SavedDesign;
      return { id, title, revision, savedAt };
    });
  }

  save(id: string, revision: string, design: Design, title?: string) {
    return this.transaction(() => {
      const current = this.read(id);
      if (current.revision !== revision)
        throw new Error(
          "Revision conflict: read the latest design and reconcile your changes before saving.",
        );
      return this.persist(this.snapshot(id, title ?? current.title, design));
    });
  }

  history(id: string) {
    this.read(id);
    return this.db
      .prepare(
        "SELECT snapshot FROM versions WHERE id = ? ORDER BY sequence DESC",
      )
      .all(id)
      .map((row) => {
        const { revision, savedAt, title } = JSON.parse(
          String(row.snapshot),
        ) as SavedDesign;
        return { revision, savedAt, title };
      });
  }

  restore(id: string, revision: string, version: string) {
    const row = this.db
      .prepare("SELECT snapshot FROM versions WHERE id = ? AND revision = ?")
      .get(id, version);
    if (!row)
      throw new Error(
        "That version does not belong to this design or is no longer retained.",
      );
    const snapshot = JSON.parse(String(row.snapshot)) as SavedDesign;
    return this.save(id, revision, snapshot.design, snapshot.title);
  }
}
