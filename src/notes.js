import { Router } from "express";
import { requireAuth } from "./auth.js";
import { AppError } from "./errors.js";
import { idParams, listQuery, noteSchema, notePatchSchema, validate, versionParams } from "./validation.js";

const NOTE_COLUMNS = "id, title, body, version, created_at AS createdAt, updated_at AS updatedAt";

/**
 * /notes — every route requires a login, and every query filters by the
 * caller's user id IN THE SAME STATEMENT that reads or writes the note.
 * A note that is not yours is reported as 404, exactly like one that does not
 * exist, so ids of other people's notes cannot be probed.
 */
export function notesRouter({ db, config }) {
  const router = Router();
  router.use(requireAuth(config));

  const insertNote = db.prepare("INSERT INTO notes (user_id, title, body) VALUES (?, ?, ?)");
  const selectNote = db.prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE id = ? AND user_id = ?`);
  const countNotes = db.prepare("SELECT COUNT(*) AS total FROM notes WHERE user_id = ?");
  const pageNotes = db.prepare(
    `SELECT ${NOTE_COLUMNS} FROM notes WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`,
  );
  const deleteNote = db.prepare("DELETE FROM notes WHERE id = ? AND user_id = ?");
  const archiveVersion = db.prepare(
    "INSERT INTO note_versions (note_id, version, title, body) VALUES (?, ?, ?, ?)",
  );
  const overwriteNote = db.prepare(
    "UPDATE notes SET title = ?, body = ?, version = version + 1, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
  );
  const selectVersions = db.prepare(
    "SELECT version, title, body, created_at AS createdAt FROM note_versions WHERE note_id = ? ORDER BY version DESC",
  );
  const selectVersion = db.prepare("SELECT title, body FROM note_versions WHERE note_id = ? AND version = ?");

  const ownNote = (id, userId) => {
    const note = selectNote.get(id, userId);
    if (!note) throw new AppError(404, "NOT_FOUND", "Note not found");
    return note;
  };

  /**
   * Replace a note's content, keeping the old content as a version. One
   * transaction: the copy and the overwrite succeed or fail together, and the
   * read happens inside it so the version number being archived is the one
   * actually being replaced.
   */
  const changeNote = db.transaction((id, userId, change) => {
    const note = ownNote(id, userId);
    archiveVersion.run(note.id, note.version, note.title, note.body);
    overwriteNote.run(change.title ?? note.title, change.body ?? note.body, id, userId);
    return ownNote(id, userId);
  });

  router.post("/", validate(noteSchema), (req, res) => {
    const { title, body } = req.valid.body;
    const { lastInsertRowid } = insertNote.run(req.userId, title, body);
    res.status(201).json(ownNote(Number(lastInsertRowid), req.userId));
  });

  router.get("/", validate(listQuery, "query"), (req, res) => {
    const { page, limit } = req.valid.query;
    const { total } = countNotes.get(req.userId);
    const data = pageNotes.all(req.userId, limit, (page - 1) * limit);
    res.json({ data, page, limit, total, totalPages: Math.ceil(total / limit) });
  });

  router.get("/:id", validate(idParams, "params"), (req, res) => {
    res.json(ownNote(req.valid.params.id, req.userId));
  });

  router.patch("/:id", validate(idParams, "params"), validate(notePatchSchema), (req, res) => {
    res.json(changeNote(req.valid.params.id, req.userId, req.valid.body));
  });

  router.delete("/:id", validate(idParams, "params"), (req, res) => {
    const { changes } = deleteNote.run(req.valid.params.id, req.userId);
    if (!changes) throw new AppError(404, "NOT_FOUND", "Note not found");
    res.status(204).end();
  });

  // Previous versions, newest first. The current one is the note itself.
  router.get("/:id/versions", validate(idParams, "params"), (req, res) => {
    const note = ownNote(req.valid.params.id, req.userId);
    res.json({ currentVersion: note.version, versions: selectVersions.all(note.id) });
  });

  // Restoring is an ordinary update whose content comes from an old version:
  // it becomes a NEW version, so history only ever grows.
  router.post("/:id/versions/:version/restore", validate(versionParams, "params"), (req, res) => {
    const { id, version } = req.valid.params;
    ownNote(id, req.userId);
    const old = selectVersion.get(id, version);
    if (!old) throw new AppError(404, "NOT_FOUND", "Version not found");
    res.json(changeNote(id, req.userId, old));
  });

  return router;
}
