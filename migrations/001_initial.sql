CREATE TABLE IF NOT EXISTS guests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_name  TEXT    NOT NULL,
  email       TEXT    NOT NULL,
  arrival     TEXT    NOT NULL,
  departure   TEXT    NOT NULL,
  unit        TEXT    NOT NULL DEFAULT '',
  email_sent  TEXT    NOT NULL DEFAULT 'no',
  synced_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_dedup
  ON guests(email, arrival, departure);
