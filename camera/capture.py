#!/usr/bin/env python3
"""farm-bed camera service — runs ON koli.

Orchestrates: capture-bed.js (recall bed preset → capture → return to backyard)
→ digital zoom (center crop) → vision-analyze → store in the media tree.

Modes:
  still   capture a bed shot then return the camera to the backyard
  sweep   (pan not available) — treated as still for now

Storage layout (on koli):
  /mnt/user/appdata/farm-bed/media/YYYY/MM/DD/still_HHMMSS.jpg
  /mnt/user/appdata/farm-bed/media/YYYY/MM/DD/*.json   (vision analysis)
"""
import base64
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from datetime import datetime

MEDIA_ROOT = "/mnt/user/appdata/farm-bed/media"
SERIAL = "T8171T1025090F93"  # Backyard SoloCam E30
SWEEP_FRAMES = 26   # frames captured across the 360° rotation
BED_FRAME = 18      # the frame where the bed lands (full view)
TILT_UP_RESET = 8   # tilt-up steps (curise_type=3) to reset to the top before positioning
TILT_DOWN = 4       # tilt-down steps (curise_type=4) from the top → bed
PAN_LEFT = 2        # pan-left steps (curise_type=1) to center horizontally
ZOOM = 0.6  # crop to the central 60% (~1.7x zoom) to focus on the bed

PROMPT = (
    "You are a garden monitor. Describe this raised-bed image concisely: "
    "which crops/seedlings are visible, their apparent health (green/healthy, wilting, yellowing), "
    "soil moisture appearance (dry/damp/wet), and sunlight vs shade. End with a one-word "
    "health rating: good, fair, or poor."
)


def sh(cmd, timeout=120):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)


def run_camera():
    """Rotate the camera (360° sweep) + capture frames; return the bed frame. Retries docker exec."""
    cmd = (f"docker exec homebridge node /tmp/sweep.js {SERIAL} /tmp/sweep "
           f"{SWEEP_FRAMES} {TILT_DOWN} {PAN_LEFT} {TILT_UP_RESET}")
    for attempt in range(5):
        r = sh(cmd, timeout=360)
        if r.stdout:
            print(r.stdout.strip())
        if r.returncode == 0:
            return f"/tmp/sweep/sweep_{BED_FRAME:03d}.jpg"
        out = (r.stdout + r.stderr).strip()
        if "OCI runtime exec failed" in out:
            print(f"docker exec transient failure (attempt {attempt + 1}/5), retrying...")
            time.sleep(5)
            continue
        print("CAMERA FAILED:", out[-300:])
        return None
    print("CAMERA FAILED after retries")
    return None


def pull_from_container(container_path, local_path):
    for attempt in range(5):
        sh(f"docker cp homebridge:{container_path} {local_path}")
        if os.path.exists(local_path) and os.path.getsize(local_path) > 0:
            return True
        time.sleep(4)
    return False


def zoom_crop(src, dst, frac=ZOOM):
    """Digital zoom: crop to the central `frac` of the frame (bed is centered)."""
    r = sh(f'ffmpeg -y -loglevel error -i {src} -vf "crop=iw*{frac}:ih*{frac}" -q:v 2 {dst}')
    return r.returncode == 0 and os.path.exists(dst) and os.path.getsize(dst) > 0


def vision_analyze(img_path):
    """Analyze via the app's /api/vision, which seeds the prompt with the CURRENT grid."""
    img = base64.b64encode(open(img_path, "rb").read()).decode()
    payload = {"image_b64": img}
    req = urllib.request.Request("http://127.0.0.1:8090/api/vision",
                                 data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    r = json.loads(urllib.request.urlopen(req, timeout=180).read())
    return r["text"]


def day_dir():
    d = os.path.join(MEDIA_ROOT, datetime.now().strftime("%Y/%m/%d"))
    os.makedirs(d, exist_ok=True)
    return d


def store(local_path, kind, analysis):
    ts = datetime.now().strftime("%H%M%S")
    ext = os.path.splitext(local_path)[1] or ".jpg"
    final = os.path.join(day_dir(), f"{kind}_{ts}{ext}")
    shutil.move(local_path, final)  # handles cross-device (/tmp -> /mnt/user)
    meta = {"kind": kind, "path": os.path.relpath(final, MEDIA_ROOT),
            "captured_at": datetime.now().isoformat(), "analysis": analysis}
    with open(os.path.join(day_dir(), f"{kind}_{ts}.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print("STORED:", final)
    print("ANALYSIS:", analysis)
    return meta


def mode_still():
    container_path = run_camera()
    if not container_path:
        print("CAMERA FAILED")
        return 1
    local = "/tmp/farm-still.jpg"
    if not pull_from_container(container_path, local):
        print("PULL FAILED")
        return 1
    # digital zoom to focus on the bed
    zoomed = "/tmp/farm-still-zoom.jpg"
    if zoom_crop(local, zoomed):
        local = zoomed
    try:
        analysis = vision_analyze(local)
    except Exception as e:
        analysis = f"vision error: {e}"
    store(local, "still", analysis)
    return 0


def mode_sweep(frames=8):
    # pan-based sweep not available (E30 pan is preset/rotate only); fall back to a still
    print("sweep unsupported on E30 — capturing a still instead")
    return mode_still()


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "still"
    if mode == "still":
        sys.exit(mode_still())
    elif mode == "sweep":
        sys.exit(mode_sweep(int(sys.argv[2]) if len(sys.argv) > 2 else 8))
    else:
        print("usage: capture.py [still|sweep [frames]]")
        sys.exit(2)
