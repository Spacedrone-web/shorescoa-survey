import 'dotenv/config';
import { createClient } from '@libsql/client';

const db = createClient({
  url: process.env.TURSO_DB_URL,
  authToken: process.env.TURSO_DB_TOKEN,
});

await db.execute(`
  CREATE TABLE IF NOT EXISTS survey_responses (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    submitted_at        TEXT DEFAULT (datetime('now')),
    arrival_date        TEXT,
    departure_date      TEXT,
    unit_number         TEXT,
    q1_purpose          TEXT,
    q2_registration     INTEGER,
    q2_packet           INTEGER,
    q2_concierge        INTEGER,
    q2_patrol           INTEGER,
    q3_concierge        INTEGER,
    q3_patrol           INTEGER,
    q3_cac              INTEGER,
    q3_maintenance      INTEGER,
    q4_indoorpoolarea   INTEGER,
    q4_indoorpool       INTEGER,
    q4_indoorhottub     INTEGER,
    q4_outdoorpoolarea  INTEGER,
    q4_outdoorpool      INTEGER,
    q4_outdoorhottub    INTEGER,
    q4_lobby            INTEGER,
    q4_elevators        INTEGER,
    q4_restrooms        INTEGER,
    q4_garage           INTEGER,
    q4_stairs           INTEGER,
    q5_overall          INTEGER,
    q6_recommend        TEXT,
    q6_comments         TEXT
  )
`);

console.log('survey_responses table created successfully.');
db.close();