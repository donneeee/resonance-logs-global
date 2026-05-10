CREATE TABLE IF NOT EXISTS encounter_entity_summaries (
    encounter_id INTEGER PRIMARY KEY NOT NULL,
    version INTEGER NOT NULL,
    data BLOB NOT NULL,
    FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE CASCADE
);

