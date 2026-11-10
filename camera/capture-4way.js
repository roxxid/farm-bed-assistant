// capture-4way.js: from preset 2, capture 4 shots — one in each direction.
// Each shot resets to preset 2 first, then pans N steps in one direction.
// usage: node capture-4way.js [serial]
const { EufySecurity } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(fs.readFileSync('/homebridge/config.json', 'utf8'));
const eufy = cfg.platforms.find(p => p.platform === 'EufySecurity');
const SERIAL = process.argv[2] || 'T8171T1025090F93';
const OUTDIR = process.argv[3] || '/tmp/shots';

// direction: 1=left 2=right 3=up 4=down
const SHOTS = [
  { name: 'left', dir: 1, steps: 5 },
  { name: 'right', dir: 2, steps: 5 },
  { name: 'up', dir: 3, steps: 4 },
  { name: 'down', dir: 4, steps: 4 },
];

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
    function onStart(_s, _d, _m, videostream) {
      ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'h264', '-i', 'pipe:0', '-frames:v', '1', '-q:v', '2', outPath]);
      videostream.pipe(ff.stdin);
      ff.on('close', () => { cleanup(); resolve(fs.existsSync(outPath) && fs.statSync(outPath).size > 0); });
      ff.on('error', () => { cleanup(); resolve(false); });
    }
    driver.on('station livestream start', onStart);
    driver.startStationLivestream(SERIAL).then(() => console.log('  livestream requested')).catch(e => { console.log('  livestream err', e.message); cleanup(); resolve(false); });
  });
}

async function grabWithRetry(driver, outPath, attempts = 2) {
  for (let i = 0; i < attempts; i++) {
    if (await grabFrame(driver, outPath)) return true;
    console.log(`  grab attempt ${i + 1} failed`);
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
  driver.setCameraMaxLivestreamDuration(120);
  fs.mkdirSync(OUTDIR, { recursive: true });
  console.log('connected');

  for (const shot of SHOTS) {
    console.log(`\n=== shot ${shot.name}: preset2 + ${shot.dir} x${shot.steps} ===`);
    // reset to preset 2
    await station.presetPosition(cam, 1);
    await sleep(4500);
    // pan in the direction
    for (let i = 0; i < shot.steps; i++) {
      await station.panAndTilt(cam, shot.dir);
      await sleep(1600);
    }
    await sleep(2500);
    const out = path.join(OUTDIR, `shot_${shot.name}.jpg`);
    const ok = await grabWithRetry(driver, out);
    console.log(ok ? `  SAVED shot_${shot.name}.jpg` : `  FAILED shot_${shot.name}`);
  }

  // return to preset 1 (rest)
  try { await station.presetPosition(cam, 0); } catch {}

  const killer = setTimeout(() => process.exit(0), 6000);
  try { await driver.close(); } catch {}
  clearTimeout(killer);
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
