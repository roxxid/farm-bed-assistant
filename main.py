"""farm-bed-assistant — FastAPI backend + static dashboard.

Serves the square-foot-garden UI and a JSON API over a SQLite store.
The /api/vision endpoint builds a prompt from the CURRENT grid state so the
local Qwen2.5-VL model can identify the bed and what's planted where.
"""
import os
import sqlite3
import json
import base64
import subprocess
import threading
import time
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

DB = os.environ.get("GARDEN_DB", "/data/garden.db")
MEDIA_DIR = os.environ.get("MEDIA_DIR", "/data/media")
VISION_URL = os.environ.get("VISION_URL", "http://host.docker.internal:8769/v1/chat/completions")
STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="farm-bed-assistant")

# ---------------------------------------------------------------------------
# plant library (square-foot gardening data) — single source of truth
# ---------------------------------------------------------------------------
PLANTS = {
    "tomato":      {"name": "Tomato",      "ico": "🍅", "per": 1,  "days": 80,  "sun": "full",    "water": "high",   "trellis": True,  "grp": "Fruiting",  "comp": "Basil, marigold, chives"},
    "pepper":      {"name": "Pepper",      "ico": "🌶️", "per": 1,  "days": 75,  "sun": "full",    "water": "medium", "trellis": False, "grp": "Fruiting",  "comp": "Basil, onion"},
    "eggplant":    {"name": "Eggplant",    "ico": "🍆", "per": 1,  "days": 80,  "sun": "full",    "water": "medium", "trellis": False, "grp": "Fruiting",  "comp": "Beans, marigold"},
    "cucumber":    {"name": "Cucumber",    "ico": "🥒", "per": 2,  "days": 60,  "sun": "full",    "water": "high",   "trellis": True,  "grp": "Fruiting",  "comp": "Beans, radish"},
    "cantaloupe":  {"name": "Cantaloupe",  "ico": "🍈", "per": 1,  "days": 85,  "sun": "full",    "water": "high",   "trellis": True,  "grp": "Fruiting",  "comp": "Marigold"},
    "peas":        {"name": "Peas",        "ico": "🫛", "per": 8,  "days": 60,  "sun": "full",    "water": "medium", "trellis": True,  "grp": "Legumes",   "comp": "Carrot, radish"},
    "beans":       {"name": "Bush beans",  "ico": "🫘", "per": 9,  "days": 55,  "sun": "full",    "water": "medium", "trellis": False, "grp": "Legumes",   "comp": "Carrot, eggplant"},
    "broccoli":    {"name": "Broccoli",    "ico": "🥦", "per": 1,  "days": 70,  "sun": "full",    "water": "medium", "trellis": False, "grp": "Brassica",  "comp": "Onion, dill"},
    "cauliflower": {"name": "Cauliflower", "ico": "🥬", "per": 1,  "days": 65,  "sun": "full",    "water": "medium", "trellis": False, "grp": "Brassica",  "comp": "Onion, celery"},
    "cabbage":     {"name": "Cabbage",     "ico": "🥬", "per": 1,  "days": 90,  "sun": "full",    "water": "medium", "trellis": False, "grp": "Brassica",  "comp": "Onion, dill"},
    "kale":        {"name": "Kale",        "ico": "🥬", "per": 4,  "days": 55,  "sun": "full",    "water": "medium", "trellis": False, "grp": "Brassica",  "comp": "Onion, beet"},
    "lettuce":     {"name": "Lettuce",     "ico": "🥬", "per": 4,  "days": 45,  "sun": "partial", "water": "medium", "trellis": False, "grp": "Leafy",     "comp": "Carrot, radish"},
    "spinach":     {"name": "Spinach",     "ico": "🍃", "per": 9,  "days": 40,  "sun": "partial", "water": "medium", "trellis": False, "grp": "Leafy",     "comp": "Strawberry, pea"},
    "onion":       {"name": "Onion",       "ico": "🧅", "per": 16, "days": 100, "sun": "full",    "water": "low",    "trellis": False, "grp": "Root",      "comp": "Carrot, lettuce"},
    "carrot":      {"name": "Carrot",      "ico": "🥕", "per": 16, "days": 70,  "sun": "full",    "water": "medium", "trellis": False, "grp": "Root",      "comp": "Onion, pea"},
    "beet":        {"name": "Beet",        "ico": "🫜", "per": 9,  "days": 55,  "sun": "full",    "water": "medium", "trellis": False, "grp": "Root",      "comp": "Onion, kale"},
    "radish":      {"name": "Radish",      "ico": "🫜", "per": 16, "days": 25,  "sun": "full",    "water": "low",    "trellis": False, "grp": "Root",      "comp": "Carrot, cucumber"},
    "garlic":      {"name": "Garlic",      "ico": "🧄", "per": 9,  "days": 210, "sun": "full",    "water": "low",    "trellis": False, "grp": "Root",      "comp": "Tomato, pepper", "perennial": True},
    "basil":       {"name": "Basil",       "ico": "🌿", "per": 4,  "days": 55,  "sun": "full",    "water": "medium", "trellis": False, "grp": "Herb",      "comp": "Tomato, pepper"},
    "thai_basil":  {"name": "Thai basil",  "ico": "🌱", "per": 4,  "days": 60,  "sun": "full",    "water": "medium", "trellis": False, "grp": "Herb",      "comp": "Tomato, pepper"},
    "cilantro":    {"name": "Cilantro",    "ico": "🍃", "per": 9,  "days": 55,  "sun": "full",    "water": "medium", "trellis": False, "grp": "Herb",      "comp": "Tomato, spinach"},
    "chives":      {"name": "Chives",      "ico": "🌿", "per": 16, "days": 60,  "sun": "full",    "water": "low",    "trellis": False, "grp": "Herb",      "comp": "Carrot, tomato"},
    "lemongrass":  {"name": "Lemongrass",  "ico": "🌾", "per": 1,  "days": 90,  "sun": "full",    "water": "medium", "trellis": False, "grp": "Herb",      "comp": "Most vegetables"},
    "rhubarb":     {"name": "Rhubarb",     "ico": "🌿", "per": 1,  "days": 365, "sun": "full",    "water": "medium", "trellis": False, "grp": "Perennial", "comp": "Permanent bed", "perennial": True},
    "curry_leaves": {"name": "Curry leaves", "ico": "🌿", "per": 1, "days": 365, "sun": "full",   "water": "medium", "trellis": False, "grp": "Perennial", "comp": "Most vegetables", "perennial": True},
    "strawberry":  {"name": "Strawberry",  "ico": "🍓", "per": 4,  "days": 90,  "sun": "full",    "water": "medium", "trellis": False, "grp": "Fruiting",  "comp": "Spinach, lettuce", "perennial": True},
    "marigold":    {"name": "Marigold",    "ico": "🌼", "per": 4,  "days": 50,  "sun": "full",    "water": "low",    "trellis": False, "grp": "Flower",    "comp": "Tomato, everything", "companion": True},
}

RECOMMENDED = [
    "tomato", "tomato", "peas", "peas", "cantaloupe", "cantaloupe",
    "pepper", "pepper", "eggplant", "eggplant", "beans", "beans",
    "broccoli", "cauliflower", "cauliflower", "cabbage", "kale", "kale",
    "lettuce", "lettuce", "lettuce", "spinach", "spinach", "rhubarb",
    "onion", "onion", "carrot", "carrot", "beet", "garlic",
    "basil", "basil", "lemongrass", "chives", "marigold", "radish",
]


def db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    schema = Path(__file__).parent / "schema.sql"
    conn = db()
    if schema.exists():
        conn.executescript(schema.read_text())
    if conn.execute("SELECT COUNT(*) c FROM bed").fetchone()["c"] == 0:
        conn.execute("INSERT INTO bed (id) VALUES (1)")
    if conn.execute("SELECT COUNT(*) c FROM squares").fetchone()["c"] == 0:
        r = conn.execute("SELECT rows, cols FROM bed WHERE id=1").fetchone()
        for row in range(r["rows"]):
            for col in range(r["cols"]):
                label = chr(ord("A") + row) + str(col + 1)
                conn.execute("INSERT INTO squares (row, col, label) VALUES (?,?,?)", (row, col, label))
    conn.commit()
    conn.close()


def plant_key_from_name(name):
    for k, v in PLANTS.items():
        if v["name"] == name:
            return k
    return None


def current_planting(conn, square_id):
    return conn.execute(
        "SELECT p.id AS pid, p.planted_at, p.expected_harvest_at, p.status, pl.name AS plant_name "
        "FROM plantings p JOIN plant_library pl ON pl.id = p.plant_id "
        "WHERE p.square_id = ? AND p.status != 'harvested' "
        "ORDER BY p.id DESC LIMIT 1", (square_id,)
    ).fetchone()


def get_grid_state(conn):
    squares = conn.execute("SELECT * FROM squares ORDER BY row, col").fetchall()
    out = []
    for s in squares:
        p = current_planting(conn, s["id"])
        planting = None
        if p:
            key = plant_key_from_name(p["plant_name"])
            info = PLANTS.get(key, {})
            planting = {
                "id": p["pid"], "plant_key": key, "plant_name": p["plant_name"],
                "ico": info.get("ico"), "per": info.get("per"), "days": info.get("days"),
                "sun": info.get("sun"), "water": info.get("water"),
                "trellis": info.get("trellis"), "grp": info.get("grp"), "comp": info.get("comp"),
                "planted_at": p["planted_at"], "expected_harvest_at": p["expected_harvest_at"],
                "status": p["status"],
            }
        out.append({
            "id": s["id"], "row": s["row"], "col": s["col"], "label": s["label"],
            "planting": planting,
        })
    return out


# ---------------------------------------------------------------------------
# startup
# ---------------------------------------------------------------------------
@app.on_event("startup")
def _startup():
    init_db()
    Path(MEDIA_DIR).mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
@app.get("/api/plants")
def api_plants():
    return {"plants": PLANTS, "recommended": RECOMMENDED}


@app.get("/api/bed")
def api_bed():
    conn = db()
    bed = dict(conn.execute("SELECT * FROM bed WHERE id=1").fetchone())
    squares = get_grid_state(conn)
    conn.close()
    return {"bed": bed, "squares": squares}


class PlantSquare(BaseModel):
    plant_key: str
    planted_at: str | None = None


@app.post("/api/squares/{square_id}/plant")
def plant_square(square_id: int, body: PlantSquare):
    if body.plant_key not in PLANTS:
        raise HTTPException(404, "unknown plant")
    conn = db()
    sq = conn.execute("SELECT * FROM squares WHERE id=?", (square_id,)).fetchone()
    if not sq:
        conn.close()
        raise HTTPException(404, "square not found")
    conn.execute("UPDATE plantings SET status='harvested' WHERE square_id=? AND status!='harvested'", (square_id,))
    planted = body.planted_at or datetime.utcnow().date().isoformat()
    days = PLANTS[body.plant_key]["days"]
    expected = (datetime.fromisoformat(planted) + timedelta(days=days)).date().isoformat()
    name = PLANTS[body.plant_key]["name"]
    conn.execute("INSERT OR IGNORE INTO plant_library (name) VALUES (?)", (name,))
    pid = conn.execute("SELECT id FROM plant_library WHERE name=?", (name,)).fetchone()["id"]
    cur = conn.execute(
        "INSERT INTO plantings (square_id, plant_id, planted_at, expected_harvest_at) VALUES (?,?,?,?)",
        (square_id, pid, planted, expected),
    )
    conn.commit()
    conn.close()
    return {"ok": True, "planting_id": cur.lastrowid, "expected_harvest_at": expected}


@app.delete("/api/squares/{square_id}/plant")
def clear_square(square_id: int):
    conn = db()
    conn.execute("UPDATE plantings SET status='harvested' WHERE square_id=? AND status!='harvested'", (square_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


class HarvestIn(BaseModel):
    harvested_at: str | None = None


@app.post("/api/plantings/{planting_id}/harvest")
def harvest_planting(planting_id: int, body: HarvestIn):
    """Mark a planting harvested (records the actual harvest date)."""
    conn = db()
    p = conn.execute("SELECT square_id FROM plantings WHERE id=?", (planting_id,)).fetchone()
    if not p:
        conn.close()
        raise HTTPException(404, "planting not found")
    when = body.harvested_at or datetime.utcnow().date().isoformat()
    conn.execute("INSERT INTO harvests (planting_id, harvested_at) VALUES (?,?)", (planting_id, when))
    conn.execute("UPDATE plantings SET status='harvested' WHERE id=?", (planting_id,))
    conn.execute("INSERT INTO logs (square_id, kind, value) VALUES (?, 'soil', 'compost-refresh-due')", (p["square_id"],))
    conn.commit()
    conn.close()
    return {"ok": True, "harvested_at": when, "soil_action": "compost-refresh-due"}


@app.get("/api/overview")
def api_overview():
    conn = db()
    squares = get_grid_state(conn)
    conn.close()
    planted = [s for s in squares if s["planting"]]
    today = datetime.utcnow().date().isoformat()
    ready = [s for s in planted if s["planting"]["expected_harvest_at"] and s["planting"]["expected_harvest_at"] <= today]
    upcoming = sorted(
        [s for s in planted if s["planting"]["expected_harvest_at"] and s["planting"]["expected_harvest_at"] > today],
        key=lambda s: s["planting"]["expected_harvest_at"],
    )
    next_harvest = upcoming[0]["planting"]["expected_harvest_at"] if upcoming else None
    next_label = upcoming[0]["label"] if upcoming else None
    return {
        "total_squares": len(squares), "planted": len(planted),
        "empty": len(squares) - len(planted), "ready": len(ready),
        "next_harvest_at": next_harvest, "next_harvest_label": next_label,
    }


class VisionIn(BaseModel):
    image_b64: str
    prompt: str | None = None


@app.post("/api/vision")
def api_vision(body: VisionIn):
    """Analyze a bed image, seeded with the CURRENT grid layout + plantings."""
    conn = db()
    squares = get_grid_state(conn)
    conn.close()
    planted = [s for s in squares if s["planting"]]
    lines = [
        "This is a 6x6 square-foot garden bed, divided into 36 one-foot squares "
        "labeled A1 (top-left) through F6 (bottom-right). The current planting plan is:",
    ]
    for s in planted:
        p = s["planting"]
        lines.append(f"- {s['label']}: {p['plant_name']} ({p['per']} per square, {p['days']} days to maturity)")
    if not planted:
        lines.append("- (nothing planted yet)")
    lines.append(
        "Analyze the image of this bed: identify the grid squares if visible, note which "
        "plants you see and where, their health (green/wilting/yellowing), soil moisture "
        "(dry/damp/wet), and sunlight vs shade. Flag any square whose contents do not match "
        "the plan above. End with a one-word overall health rating: good, fair, or poor."
    )
    prompt = body.prompt or "\n".join(lines)
    payload = {"messages": [{"role": "user", "content": [
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{body.image_b64}"}},
        {"type": "text", "text": prompt},
    ]}], "temperature": 0.1, "max_tokens": 400}
    req = urllib.request.Request(VISION_URL, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        r = json.loads(urllib.request.urlopen(req, timeout=180).read())
        return {"text": r["choices"][0]["message"]["content"], "context": prompt}
    except Exception as e:
        raise HTTPException(502, f"vision model error: {e}")


@app.get("/api/media")
def api_media():
    out = []
    if os.path.isdir(MEDIA_DIR):
        for root, _dirs, files in os.walk(MEDIA_DIR):
            for f in sorted(files):
                if f.endswith((".jpg", ".jpeg", ".png", ".mp4")):
                    full = os.path.join(root, f)
                    rel = os.path.relpath(full, MEDIA_DIR)
                    jsonside = os.path.splitext(full)[0] + ".json"
                    analysis = None
                    captured_at = None
                    if os.path.exists(jsonside):
                        try:
                            meta = json.load(open(jsonside))
                            analysis = meta.get("analysis")
                            captured_at = meta.get("captured_at")
                        except Exception:
                            pass
                    kind = "sweep" if f.endswith(".mp4") else "still"
                    out.append({"path": rel, "kind": kind, "url": f"/media/{rel}",
                                "captured_at": captured_at, "analysis": analysis})
    out.sort(key=lambda m: m.get("captured_at") or "", reverse=True)
    return {"media": out}


# ---------------------------------------------------------------------------
# camera controls (drive the E30 via the homebridge container)
# ---------------------------------------------------------------------------
CAM_SERIAL = "T8171T1025090F93"
DIR_MAP = {"left": 1, "right": 2, "up": 3, "down": 4}
PRESET_MAP = {"bed": 1, "rest": 0}
_cam_lock = threading.Lock()  # serialize camera ops — the E30 can't do concurrent commands


def _run_cam(*args, timeout=150):
    with _cam_lock:
        last = ""
        for attempt in range(8):
            try:
                r = subprocess.run(["docker", "exec", "homebridge", "node", *args],
                                   capture_output=True, text=True, timeout=timeout)
                out = (r.stdout or "") + (r.stderr or "")
                if r.returncode == 0:
                    return 0, out
                last = out
                # transient docker exec bug — retry with growing backoff
                if "OCI runtime exec failed" in out:
                    time.sleep(5 + attempt * 3)
                    continue
                return r.returncode, out
            except subprocess.TimeoutExpired:
                last = f"timeout after {timeout}s"
                time.sleep(5)
                continue
        return 1, f"docker exec failed after retries: {last.strip()[-200:]}"


class CamMove(BaseModel):
    direction: str
    steps: int = 1


@app.post("/api/camera/move")
def camera_move(body: CamMove):
    d = DIR_MAP.get(body.direction)
    if d is None:
        raise HTTPException(400, "direction must be left/right/up/down")
    steps = max(1, min(int(body.steps), 20))
    code, out = _run_cam("/tmp/camera-move.js", str(d), str(steps), CAM_SERIAL)
    return {"ok": code == 0, "out": out.strip()[-200:]}


class CamPreset(BaseModel):
    preset: str  # "bed" or "rest"


@app.post("/api/camera/preset")
def camera_preset(body: CamPreset):
    p = PRESET_MAP.get(body.preset)
    if p is None:
        raise HTTPException(400, "preset must be bed/rest")
    code, out = _run_cam("/tmp/preset.js", str(p), CAM_SERIAL)
    return {"ok": code == 0, "out": out.strip()[-200:]}


@app.post("/api/camera/snapshot")
def camera_snapshot():
    """Grab a fresh frame from the camera's current view + serve it (retries once)."""
    out = ""
    for attempt in range(2):
        code, out = _run_cam("/tmp/capture-now.js", CAM_SERIAL, "/tmp/snap.jpg")
        if code == 0:
            subprocess.run(["docker", "cp", "homebridge:/tmp/snap.jpg", "/data/media/live-snap.jpg"],
                           capture_output=True, timeout=60)
            return {"url": f"/media/live-snap.jpg?v={int(time.time())}"}
        print(f"[SNAP] attempt {attempt} failed: {out.strip()[-400:]}", flush=True)
        time.sleep(4)
    raise HTTPException(502, f"capture failed: {out.strip()[-200:]}")


@app.post("/api/camera/save-preset")
def camera_save_preset(body: CamPreset):
    """Save the camera's CURRENT position as a named preset (bed/rest)."""
    p = PRESET_MAP.get(body.preset)
    if p is None:
        raise HTTPException(400, "preset must be bed/rest")
    code, out = _run_cam("/tmp/save-preset.js", str(p), CAM_SERIAL)
    return {"ok": code == 0, "out": out.strip()[-200:]}


# ---------------------------------------------------------------------------
# static frontend
# ---------------------------------------------------------------------------
app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/edit")
def edit():
    return FileResponse(STATIC_DIR / "edit.html")
