# Camera service

Drives the Eufy SoloCam E30 (Backyard) to capture the farm bed and analyze it
with the local Qwen2.5-VL-7B vision model.

## Proven primitives (all working)
| Script | What it does | Runs where |
|---|---|---|
| `pan.js` | Pan/tilt the camera (`0=rotate360 1=left 2=right 3=up 4=down`) | homebridge container |
| `capture-frame.js` | Grab a fresh JPEG frame (P2P livestream + ffmpeg) | homebridge container |
| `vision.py` | Analyze an image with the vision model | koli host |
| `capture.py` | Orchestrates pan → capture → vision → store | koli host |

## Notes / gotchas
- The E30 is a **battery** camera — it has **no RTSP**. Frames come from a
  short P2P livestream (startStationLivestream → pipe H.264 to ffmpeg, grab 1 frame).
- The livestream needs the station P2P session to connect first; the frame grab
  can take 15–30s on a cold camera (wake-up). `capture-frame.js` allows 60s.
- `PAN_TO_BED` / `PAN_TO_REST` in `capture.py` are **placeholders** and must be
  tuned against the live view (the exact step count to swing 180° and tilt down
  to the bed is camera-installation specific).

## Deploy to koli
```bash
# from a machine with the repo checked out
scp camera/pan.js camera/capture-frame.js root@koli:/tmp/farm-pan.js  # etc.
ssh root@koli 'docker cp /tmp/farm-pan.js homebridge:/tmp/ && docker cp /tmp/farm-snap.js homebridge:/tmp/'
ssh root@koli 'python3 /path/capture.py still'   # hourly
ssh root@koli 'python3 /path/capture.py sweep 8' # daily
```

Storage: `/mnt/user/appdata/farm-bed/media/YYYY/MM/DD/{still,sweep}_HHMMSS.{jpg,mp4}` + JSON analysis.
