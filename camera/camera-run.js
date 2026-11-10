// Single-connection camera service: connect ONCE, recall preset, capture, return, close.
// Uses the Eufy preset position the user saved (preset 2 = the farm bed).
// Usage: node camera-run.js still|sweep [serial] [outdir]
const { EufySecurity } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(fs.readFileSync('/homebridge/config.json', 'utf8'));
const eufy = cfg.platforms.find(p => p.platform === 'EufySecurity');
const MODE = process.argv[2] || 'still';
const SERIAL = process.argv[3] || 'T8171T1025090F93';
const OUTDIR = process.argv[4] || '/tmp';
const SWEEP_FRAMES = 8;

// Eufy preset slots: 0=PRESET_1, 1=PRESET_2, 2=PRESET_3, 3=PRESET_4
const PRESET_BED = 1;   // preset 2 = the farm bed
const PRESET_REST = 0;  // preset 1 = backyard resting

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function grabFrame(driver, outPath, timeoutMs = 40000) {
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

async function grabFrameWithRetry(driver, outPath, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    const ok = await grabFrame(driver, outPath, 40000);
    if (ok) return true;
    console.log(`frame grab attempt ${i + 1}/${attempts} failed — retrying`);
    try { await driver.stopStationLivestream(SERIAL); } catch {}
    await sleep(6000);
  }
  return false;
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
  driver.setCameraMaxLivestreamDuration(120); // don't auto-stop mid-wake
  console.log('connected | station:', station.getName(), '| cam:', cam.getName());

  // CRITICAL: wait for the station P2P session to connect, else pan/preset
  // commands are silently dropped (the camera never moves).
  const connStart = Date.now();
  while (!station.isConnected() && Date.now() - connStart < 30000) {
    await sleep(500);
  }
  console.log('station P2P connected:', station.isConnected());

  // recall the bed preset
  console.log(`recalling bed preset (${PRESET_BED})...`);
  await station.presetPosition(cam, PRESET_BED);
  await sleep(5000); // let the camera physically move + settle

  const ts = Date.now();
  if (MODE === 'sweep') {
    const frames = [];
    console.log(`capturing ${SWEEP_FRAMES} frames...`);
    for (let i = 0; i < SWEEP_FRAMES; i++) {
      const p = path.join(OUTDIR, `sweep_${ts}_f${String(i).padStart(2, '0')}.jpg`);
      const ok = await grabFrameWithRetry(driver, p, 2);
      if (ok) frames.push(p);
      await sleep(1000);
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
    const ok = await grabFrameWithRetry(driver, out);
    console.log(ok ? ('STILL_SAVED ' + out) : 'STILL_FAILED');
  }

  // return to the resting preset
  console.log(`returning to rest preset (${PRESET_REST})...`);
  try { await station.presetPosition(cam, PRESET_REST); } catch {}

  console.log('closing...');
  const killer = setTimeout(() => process.exit(0), 6000);
  try { await driver.close(); } catch {}
  clearTimeout(killer);
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
