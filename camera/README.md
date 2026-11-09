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
- The E30 is a **battery** camera (currently `power: plugged`, battery 100%) — it has
  **no RTSP** (`rtspStream` property is undefined; `CMD_NAS_SWITCH` sent but no URL). Frames
  come from a short P2P livestream (startStationLivestream → pipe H.264 to ffmpeg, grab 1 frame).
- **Use ONE connection per run** (`camera-run.js`). Separate `pan.js` + `capture-frame.js`
  processes each open their own P2P session and leave stale ones behind, which blocks the
  next livestream. `camera-run.js` connects once and does pan → capture → pan back → close.
- `driver.close()` hangs on P2P teardown — always guard with a hard `process.exit` timer.
- **Livestream is flaky**: the first grab succeeds, but repeat runs often time out waiting
  for the `station livestream start` event (the stream simply never starts). Suspected
  causes: battery-cam sleep/wake cycle, a livestream cooldown, or conflict with the
  Homebridge plugin's own HomeKit livestream on the same camera. Needs investigation —
  see the capture-failure notes.
- `PAN_TO_BED` / `PAN_TO_REST` are **placeholders** and must be tuned against the live view.

## Deploy to koli
```bash
# from a machine with the repo checked out
scp camera/pan.js camera/capture-frame.js root@koli:/tmp/farm-pan.js  # etc.
ssh root@koli 'docker cp /tmp/farm-pan.js homebridge:/tmp/ && docker cp /tmp/farm-snap.js homebridge:/tmp/'
ssh root@koli 'python3 /path/capture.py still'   # hourly
ssh root@koli 'python3 /path/capture.py sweep 8' # daily
```

Storage: `/mnt/user/appdata/farm-bed/media/YYYY/MM/DD/{still,sweep}_HHMMSS.{jpg,mp4}` + JSON analysis.
