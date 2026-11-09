// Single-connection camera service: connect ONCE, pan, capture, pan back, close.
// Avoids the stale-P2P-session churn of separate per-command processes.
// Usage: node camera-run.js still|sweep [serial] [outdir]
const { EufySecurity } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(fs.readFileSync('/homebridge/config.json', 'utf8'));
const eufy = cfg.platforms.find(p => p.platform === 'EufySecurity');
const MODE = process.argv[2] || 'still';
const SERIAL = process.argv[3] || 'T8171T1025090F93';
const OUTDIR = process.argv[4] || '/tmp';
const SWEEP_FRAMES = 8;

// pan/tilt: 0=rotate360 1=left 2=right 3=up 4=down
const PAN_TO_BED = [[2, 4], [4, 3]];
const PAN_TO_REST = [[3, 3], [1, 4]];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function pan(station, cam, direction, count = 1) {
  for (let i = 0; i < count; i++) {
    await station.panAndTilt(cam, direction);
    console.log(`pan dir ${direction} (${i + 1}/${count})`);
    await sleep(1800);
  }
}

function grabFrame(driver, station, cam, outPath, timeoutMs = 45000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
    let ff = null;
    function cleanup() {
      if (ff) { try { ff.stdin.end(); } catch {} }
      clearTimeout(timer);
      driver.off('station livestream start', onStart);
    }
    function onStart(_st, _dev, metadata, videostream) {
      ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'h264', '-i', 'pipe:0',
        '-frames:v', '1', '-q:v', '2', outPath]);
      videostream.pipe(ff.stdin);
      ff.on('close', () => {
        cleanup();
        resolve(fs.existsSync(outPath) && fs.statSync(outPath).size > 0);
      });
      ff.on('error', () => { cleanup(); resolve(false); });
    }
    driver.on('station livestream start', onStart);
    driver.startStationLivestream(SERIAL).then(() => console.log('livestream requested')).catch(e => { console.log('livestream err', e.message); cleanup(); resolve(false); });
  });
}

(async () => {
  const driver = await EufySecurity.initialize({
    country: eufy.country || 'US', language: 'en',
    username: eufy.username, password: eufy.password,
    persistentDir: '/homebridge/eufysecurity',
  });
  await driver.connect();
  const cam = await driver.getDevice(SERIAL);
  const station = await driver.getStation(cam.getStationSerial());
  console.log('connected | station:', station.getName(), '| cam:', cam.getName());

  // pan to bed
  console.log('panning to bed...');
  for (const [d, c] of PAN_TO_BED) await pan(station, cam, d, c);
  await sleep(2000);

  const ts = Date.now();
  if (MODE === 'sweep') {
    const frames = [];
    console.log(`capturing ${SWEEP_FRAMES} frames...`);
    for (let i = 0; i < SWEEP_FRAMES; i++) {
      const p = path.join(OUTDIR, `sweep_${ts}_f${String(i).padStart(2, '0')}.jpg`);
      const ok = await grabFrame(driver, station, cam, p);
      if (ok) frames.push(p);
      await pan(station, cam, 2, 1); // rotate right between frames
    }
    console.log(`captured ${frames.length}/${SWEEP_FRAMES} frames`);
    if (frames.length) {
      const clip = path.join(OUTDIR, `sweep_${ts}.mp4`);
      const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '4',
        '-pattern_type', 'glob', '-i', path.join(OUTDIR, `sweep_${ts}_f*.jpg`),
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip]);
      console.log('stitched:', clip, '(rc', r.status + ')');
    }
  } else {
    const out = path.join(OUTDIR, `still_${ts}.jpg`);
    console.log('capturing still...');
    const ok = await grabFrame(driver, station, cam, out);
    console.log(ok ? ('STILL_SAVED ' + out) : 'STILL_FAILED');
  }

  // pan back to rest
  console.log('panning back...');
  for (const [d, c] of PAN_TO_REST) await pan(station, cam, d, c);

  console.log('closing...');
  const killer = setTimeout(() => process.exit(0), 6000);
  try { await driver.close(); } catch {}
  clearTimeout(killer);
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });

function spawnSync(cmd, args) {
  return require('child_process').spawnSync(cmd, args);
}
