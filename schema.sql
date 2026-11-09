-- farm-bed-assistant — SQLite schema (square-foot gardening tracker)
PRAGMA journal_mode=WAL;

-- the raised bed
CREATE TABLE IF NOT EXISTS bed (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    rows          INTEGER NOT NULL DEFAULT 6,
    cols          INTEGER NOT NULL DEFAULT 6,
    width_in      REAL NOT NULL DEFAULT 70,   -- 5'10"
    length_in     REAL NOT NULL DEFAULT 71,   -- 5'11"
    depth_in      REAL NOT NULL DEFAULT 10,
    soil_mix      TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- plant library: square-foot-gardening knowledge per crop
CREATE TABLE IF NOT EXISTS plant_library (
    id                  INTEGER PRIMARY KEY,
    name                TEXT NOT NULL UNIQUE,   -- e.g. 'Tomato'
    variety             TEXT,
    plants_per_sqft     INTEGER,                -- 1 tomato, 4 lettuce, 9 spinach, 16 carrot
    days_to_maturity    INTEGER,                -- readiness signal
    sun_requirement     TEXT,                   -- full | partial | shade
    water_need          TEXT,                   -- low | medium | high
    notes               TEXT                    -- companion / rotation / spacing
);

-- each one-foot square of the grid
CREATE TABLE IF NOT EXISTS squares (
    id        INTEGER PRIMARY KEY,
    row       INTEGER NOT NULL,
    col       INTEGER NOT NULL,
    label     TEXT,                              -- 'A3' etc.
    UNIQUE(row, col)
);

-- a planting event in a square (current or historical)
CREATE TABLE IF NOT EXISTS plantings (
    id                INTEGER PRIMARY KEY,
    square_id         INTEGER NOT NULL REFERENCES squares(id),
    plant_id          INTEGER NOT NULL REFERENCES plant_library(id),
    planted_at        TEXT NOT NULL DEFAULT (datetime('now')),
    germinated_at     TEXT,
    expected_harvest_at TEXT,                    -- computed from days_to_maturity
    status            TEXT NOT NULL DEFAULT 'seeded'
                      CHECK (status IN ('seeded','germinated','growing','ready','harvested','soil-rest')),
    notes             TEXT
);

-- harvest events; trigger the compost-refresh (soil-rest) cycle
CREATE TABLE IF NOT EXISTS harvests (
    id           INTEGER PRIMARY KEY,
    planting_id  INTEGER NOT NULL REFERENCES plantings(id),
    harvested_at TEXT NOT NULL DEFAULT (datetime('now')),
    yield_qty    REAL,
    yield_unit   TEXT,
    notes        TEXT
);

-- typed observations per square or whole bed
CREATE TABLE IF NOT EXISTS logs (
    id         INTEGER PRIMARY KEY,
    square_id  INTEGER REFERENCES squares(id),   -- NULL = whole bed
    kind       TEXT NOT NULL CHECK (kind IN ('water','soil','health','sunlight','note')),
    value      TEXT,
    detail     TEXT,
    logged_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- camera media (hourly stills + daily 10s sweep clips)
CREATE TABLE IF NOT EXISTS media (
    id         INTEGER PRIMARY KEY,
    kind       TEXT NOT NULL CHECK (kind IN ('still','sweep')),
    path       TEXT NOT NULL,                    -- relative under YYYY/MM/DD/
    captured_at TEXT NOT NULL DEFAULT (datetime('now')),
    ai_summary TEXT                               -- vision model output (sun/shade/health)
);
