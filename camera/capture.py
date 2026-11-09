#!/usr/bin/env python3
"""farm-bed camera service — runs ON koli.

Orchestrates: pan camera -> capture frame(s) -> vision-analyze -> store.

Modes:
  still   single hourly frame of the bed
  sweep   pan across the bed capturing N frames, stitch into a clip

Storage layout (on koli):
  /mnt/user/appdata/farm-bed/media/YYYY/MM/DD/still_HHMMSS.jpg
  /mnt/user/appdata/farm-bed/media/YYYY/MM/DD/sweep_HHMMSS.mp4
  /mnt/user/appdata/farm-bed/media/YYYY/MM/DD/*.json   (vision analysis)
"""
import json
import os
import subprocess
import sys
import time
from datetime import datetime

MEDIA_ROOT = "/mnt/user/appdata/farm-bed/media"
VISION_URL = "http://127.0.0.1:8769/v1/chat/completions"
SERIAL = "T8171T1025090F93"  # Backyard SoloCam E30

# pan/tilt: 0=rotate360 1=left 2=right 3=up 4=down
# Sequence to go from backyard resting -> farm bed (TUNE THIS against the live view)
PAN_TO_BED = [(2, 4), (4, 3)]   # e.g. rotate right x4, tilt down x3
PAN_TO_REST = [(3, 3), (1, 4)]  # tilt up x3, rotate left x4 (reverse)

PROMPT = (
    "You are a garden monitor. Describe this raised-bed image concisely: "
    "which crops/seedlings are visible, their apparent health (green/healthy, wilting, yellowing), "
    "soil moisture appearance (dry/damp/wet), and sunlight vs shade. End with a one-word "
    "health rating: good, fair, or poor."
)


def sh(cmd, timeout=120):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
    return r


def docker_exec(container_cmd, timeout=120):
    return sh(f"docker exec homebridge {container_cmd}", timeout)


def pan(direction, count=1):
    for _ in range(count):
        r = docker_exec(f"node /tmp/farm-pan.js {direction} {SERIAL}")
        if r.returncode != 0:
            print("PAN FAILED:", r.stderr[-200:])
            return False
        time.sleep(1.5)
    return True


def capture_frame(out_path):
    r = docker_exec(f"node /tmp/farm-snap.js {SERIAL} {out_path}", timeout=90)
    return r.returncode == 0 and os.path.exists(out_path)


def vision_analyze(img_path):
    import base64, urllib.request
    img = base64.b64encode(open(img_path, "rb").read()).decode()
    payload = {"messages": [{"role": "user", "content": [
        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + img}},
        {"type": "text", "text": PROMPT},
    ]}], "temperature": 0.1, "max_tokens": 300}
    req = urllib.request.Request(VISION_URL, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    r = json.loads(urllib.request.urlopen(req, timeout=180).read())
    return r["choices"][0]["message"]["content"]


def day_dir():
    d = os.path.join(MEDIA_ROOT, datetime.now().strftime("%Y/%m/%d"))
    os.makedirs(d, exist_ok=True)
    return d


def store(img_path, kind, analysis):
    ts = datetime.now().strftime("%H%M%S")
    ext = ".jpg" if kind == "still" else ".mp4"
    final = os.path.join(day_dir(), f"{kind}_{ts}{ext}")
    os.rename(img_path, final)
    meta = {"kind": kind, "path": os.path.relpath(final, MEDIA_ROOT),
            "captured_at": datetime.now().isoformat(), "analysis": analysis}
    with open(os.path.join(day_dir(), f"{kind}_{ts}.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print("STORED:", final)
    print("ANALYSIS:", analysis)
    return meta


def mode_still():
    tmp = "/tmp/farm-still.jpg"
    print("panning to bed...")
    for d, c in PAN_TO_BED:
        if not pan(d, c):
            return 1
    time.sleep(3)
    print("capturing frame...")
    if not capture_frame(tmp):
        print("CAPTURE FAILED")
        return 1
    analysis = vision_analyze(tmp)
    store(tmp, "still", analysis)
    print("panning back to rest...")
    for d, c in PAN_TO_REST:
        pan(d, c)
    return 0


def mode_sweep(frames=8):
    tmpdir = "/tmp/farm-sweep"
    sh(f"rm -rf {tmpdir}; mkdir -p {tmpdir}")
    print("panning to bed...")
    for d, c in PAN_TO_BED:
        if not pan(d, c):
            return 1
    time.sleep(2)
    print(f"capturing {frames} frames across the bed...")
    paths = []
    for i in range(frames):
        p = f"{tmpdir}/f{i:02d}.jpg"
        if capture_frame(p):
            paths.append(p)
        pan(2, 1)  # rotate right between frames
        time.sleep(1)
    if not paths:
        print("NO FRAMES CAPTURED")
        return 1
    ts = datetime.now().strftime("%H%M%S")
    clip = f"{tmpdir}/sweep.mp4"
    r = sh(f"ffmpeg -y -loglevel error -framerate 4 -pattern_type glob -i '{tmpdir}/f*.jpg' -c:v libx264 -pix_fmt yuv420p {clip}")
    if r.returncode != 0:
        print("STITCH FAILED:", r.stderr[-300:])
        return 1
    # analyze the last frame as the representative view
    analysis = vision_analyze(paths[-1])
    store(clip, "sweep", analysis)
    for p in paths:
        os.remove(p)
    print("panning back to rest...")
    for d, c in PAN_TO_REST:
        pan(d, c)
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
