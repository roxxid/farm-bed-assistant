"""farm-bed-assistant — FastAPI backend for the square-foot garden tracker."""
import os
import sqlite3
import base64
import json
import urllib.request
from datetime import datetime, timedelta

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DB = os.environ.get("GARDEN_DB", "/data/garden.db")
VISION_URL = os.environ.get("VISION_URL", "http://host.docker.internal:8769/v1/chat/completions")

app = FastAPI(title="farm-bed-assistant")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@app.on_event("startup")
def _init():
    schema = os.path.join(os.path.dirname(__file__), "..", "schema.sql")
    if os.path.exists(schema):
        conn = db()
        conn.executescript(open(schema).read())
        # seed the bed + 36 squares if empty
        if conn.execute("SELECT COUNT(*) c FROM bed").fetchone()["c"] == 0:
            conn.execute("INSERT INTO bed (id) VALUES (1)")
        if conn.execute("SELECT COUNT(*) c FROM squares").fetchone()["c"] == 0:
            rows = conn.execute("SELECT rows, cols FROM bed WHERE id=1").fetchone()
            for r in range(rows["rows"]):
                for c in range(rows["cols"]):
                    label = chr(ord("A") + r) + str(c + 1)
                    conn.execute("INSERT INTO squares (row, col, label) VALUES (?,?,?)", (r, c, label))
        conn.commit()
        conn.close()


# ---------- bed ----------
@app.get("/bed")
def get_bed():
    return dict(db().execute("SELECT * FROM bed WHERE id=1").fetchone())


# ---------- squares ----------
@app.get("/squares")
def list_squares():
    rows = db().execute("""
        SELECT s.*, p.id AS planting_id, pl.name AS plant_name, pl.days_to_maturity,
               p.planted_at, p.status
        FROM squares s
        LEFT JOIN plantings p ON p.id = (SELECT id FROM plantings WHERE square_id=s.id ORDER BY id DESC LIMIT 1)
        LEFT JOIN plant_library pl ON pl.id = p.plant_id
        ORDER BY s.row, s.col
    """).fetchall()
    return [dict(r) for r in rows]


# ---------- plant library ----------
@app.get("/plants")
def list_plants():
    return [dict(r) for r in db().execute("SELECT * FROM plant_library ORDER BY name").fetchall()]


class PlantIn(BaseModel):
    name: str
    variety: str | None = None
    plants_per_sqft: int | None = None
    days_to_maturity: int | None = None
    sun_requirement: str | None = None
    water_need: str | None = None
    notes: str | None = None


@app.post("/plants")
def add_plant(p: PlantIn):
    conn = db()
    cur = conn.execute(
        "INSERT INTO plant_library (name, variety, plants_per_sqft, days_to_maturity, sun_requirement, water_need, notes) VALUES (?,?,?,?,?,?,?)",
        (p.name, p.variety, p.plants_per_sqft, p.days_to_maturity, p.sun_requirement, p.water_need, p.notes),
    )
    conn.commit()
    return {"id": cur.lastrowid}


# ---------- plantings ----------
class PlantingIn(BaseModel):
    square_id: int
    plant_id: int
    planted_at: str | None = None


@app.post("/plantings")
def add_planting(p: PlantingIn):
    conn = db()
    plant = conn.execute("SELECT days_to_maturity FROM plant_library WHERE id=?", (p.plant_id,)).fetchone()
    if not plant:
        raise HTTPException(404, "plant not found")
    planted = p.planted_at or datetime.utcnow().isoformat()
    expected = None
    if plant["days_to_maturity"]:
        expected = (datetime.fromisoformat(planted) + timedelta(days=plant["days_to_maturity"])).isoformat()
    cur = conn.execute(
        "INSERT INTO plantings (square_id, plant_id, planted_at, expected_harvest_at) VALUES (?,?,?,?)",
        (p.square_id, p.plant_id, planted, expected),
    )
    conn.commit()
    return {"id": cur.lastrowid, "expected_harvest_at": expected}


# ---------- logs ----------
class LogIn(BaseModel):
    square_id: int | None = None
    kind: str
    value: str | None = None
    detail: str | None = None


@app.post("/logs")
def add_log(l: LogIn):
    conn = db()
    cur = conn.execute("INSERT INTO logs (square_id, kind, value, detail) VALUES (?,?,?,?)",
                       (l.square_id, l.kind, l.value, l.detail))
    conn.commit()
    return {"id": cur.lastrowid}


# ---------- harvest (triggers soil-rest) ----------
class HarvestIn(BaseModel):
    planting_id: int
    yield_qty: float | None = None
    yield_unit: str | None = None
    notes: str | None = None


@app.post("/harvests")
def add_harvest(h: HarvestIn):
    conn = db()
    planting = conn.execute("SELECT square_id FROM plantings WHERE id=?", (h.planting_id,)).fetchone()
    if not planting:
        raise HTTPException(404, "planting not found")
    cur = conn.execute("INSERT INTO harvests (planting_id, yield_qty, yield_unit, notes) VALUES (?,?,?,?)",
                       (h.planting_id, h.yield_qty, h.yield_unit, h.notes))
    # mark the planting harvested + the square needs compost refresh
    conn.execute("UPDATE plantings SET status='harvested' WHERE id=?", (h.planting_id,))
    conn.execute("INSERT INTO logs (square_id, kind, value) VALUES (?, 'soil', 'compost-refresh-due')",
                 (planting["square_id"],))
    conn.commit()
    return {"id": cur.lastrowid, "soil_action": "compost-refresh-due"}


# ---------- vision ----------
class VisionIn(BaseModel):
    image_b64: str
    prompt: str = "Describe this garden bed image."


@app.post("/vision")
def analyze(v: VisionIn):
    payload = {"messages": [{"role": "user", "content": [
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{v.image_b64}"}},
        {"type": "text", "text": v.prompt},
    ]}], "temperature": 0.1, "max_tokens": 400}
    req = urllib.request.Request(VISION_URL, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    r = json.loads(urllib.request.urlopen(req, timeout=180).read())
    return {"text": r["choices"][0]["message"]["content"]}
