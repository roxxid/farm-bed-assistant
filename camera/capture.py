#!/usr/bin/env python3
"""farm-bed camera service — runs ON koli.

Orchestrates: camera-run.js (pan → capture → pan back, single connection)
→ vision-analyze the result → store in the media tree.

Modes:
  still   single hourly frame of the bed
  sweep   pan across the bed capturing N frames, stitch into a clip

Storage layout (on koli):
  /mnt/user/appdata/farm-bed/media/YYYY/MM/DD/still_HHMMSS.jpg
  /mnt/user/appdata/farm-bed/media/YYYY/MM/DD/sweep_HHMMSS.mp4
  /mnt/user/appdata/farm-bed/media/YYYY/MM/DD/*.json   (vision analysis)
"""
import base64
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from datetime import datetime

MEDIA_ROOT = "/mnt/user/appdata/farm-bed/media"
VISION_URL = "http://127.0.0.1:8769/v1/chat/completions"
SERIAL = "T8171T1025090F93"  # Backyard SoloCam E30

PROMPT = (
    "You are a garden monitor. Describe this raised-bed image concisely: "
    "which crops/seedlings are visible, their apparent health (green/healthy, wilting, yellowing), "
    "soil moisture appearance (dry/damp/wet), and sunlight vs shade. End with a one-word "
    "health rating: good, fair, or poor."
)


def sh(cmd, timeout=120):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)


def run_camera(mode):
    """Capture the bed's current (default) view — no pan (the default is now the bed)."""
    r = sh(f"docker exec homebridge node /tmp/capture-now.js {SERIAL} /tmp/capture-now.jpg", timeout=360)
    if r.stdout:
        print(r.stdout.strip())
    if r.returncode != 0:
        return None
    return "/tmp/capture-now.jpg"


def pull_from_container(container_path, local_path):
    sh(f"docker cp homebridge:{container_path} {local_path}")
    return os.path.exists(local_path) and os.path.getsize(local_path) > 0


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
    ext = os.path.splitext(local_path)[1] or (".jpg" if kind == "still" else ".mp4")
    final = os.path.join(day_dir(), f"{kind}_{ts}{ext}")
    shutil.move(local_path, final)  # shutil.move handles cross-device (/tmp -> /mnt/user)
    meta = {"kind": kind, "path": os.path.relpath(final, MEDIA_ROOT),
            "captured_at": datetime.now().isoformat(), "analysis": analysis}
    with open(os.path.join(day_dir(), f"{kind}_{ts}.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print("STORED:", final)
    print("ANALYSIS:", analysis)
    return meta


def mode_still():
    container_path = run_camera("still")
    if not container_path:
        print("CAMERA FAILED")
        return 1
    local = "/tmp/farm-still.jpg"
    if not pull_from_container(container_path, local):
        print("PULL FAILED")
        return 1
    try:
        analysis = vision_analyze(local)
    except Exception as e:
        analysis = f"vision error: {e}"
    store(local, "still", analysis)
    return 0


def mode_sweep(frames=8):
    container_clip = run_camera("sweep")
    if not container_clip:
        print("CAMERA SWEEP FAILED")
        return 1
    local = "/tmp/farm-sweep.mp4"
    if not pull_from_container(container_clip, local):
        print("PULL FAILED")
        return 1
    sh(f"ffmpeg -y -loglevel error -i {local} -frames:v 1 /tmp/farm-sweep-still.jpg")
    try:
        analysis = vision_analyze("/tmp/farm-sweep-still.jpg")
    except Exception as e:
        analysis = f"vision error: {e}"
    store(local, "sweep", analysis)
    return 0


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "still"
    if mode == "still":
        sys.exit(mode_still())
    elif mode == "sweep":
        sys.exit(mode_sweep(int(sys.argv[2]) if len(sys.argv) > 2 else 8))
    else:
        print("usage: capture.py [still|sweep [frames]]")
        sys.exit(2)
