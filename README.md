# farm-bed-assistant

Self-hosted square-foot gardening tracker for the raised bed.

## What it does
- 6×6 grid of one-foot squares; plant, track, and harvest per square.
- Square-foot principles: plants-per-sqft, days-to-maturity, sun/water needs.
- Logs water, soil/amendments, plant health, and sunlight per square.
- Harvest tracking with the **post-harvest compost-refresh cycle** (soil-rest → replenish → replant).
- Camera monitoring: hourly stills + a daily 10-sec sweep of the bed, stored under `YYYY/MM/DD/`.
- A local vision model (Qwen2.5-VL-7B) analyzes footage for sunlight/shade, health, and growth.

## Stack
- FastAPI + SQLite (schema in `schema.sql`).
- Runs as a Docker container on Unraid.

## Run
```
docker build -t farm-bed-assistant .
docker run -p 8000:8000 -v /path/to/data:/data farm-bed-assistant
```

## Camera + vision (see `eufy-camera-control` skill)
- Eufy SoloCam E30 (pan/tilt) + HomeBase 3, via the Homebridge container.
- Vision model at `http://host.docker.internal:8769` (Qwen2.5-VL-7B on the T4).
