// preset-test.js: recall each preset slot (0-3) and capture a frame.
// usage: node preset-test.js [serial]
const { EufySecurity } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(fs.readFileSync('/homebridge/config.json', 'utf8'));
const eufy = cfg.platforms.find(p => p.platform === 'EufySecurity');
const SERIAL = process.argv[2] || 'T8171T1025090F93';
const OUTDIR = process.argv[3] || '/tmp/presets';

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
    driver.startStationLivestream(SERIAL).then(() => {}).catch(e => { console.log('  livestream err', e.message); cleanup(); resolve(false); });
  });
}

async function grabWithRetry(driver, outPath, attempts = 2) {
  for (let i = 0; i < attempts; i++) {
    if (await grabFrame(driver, outPath)) return true;
    try { await driver.stopStationLivestream(SERIAL); } catch {}
    await sleep(5000);
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

  for (let preset = 0; preset < 4; preset++) {
    console.log(`\n=== preset ${preset} (PRESET_${preset + 1}) ===`);
    await station.presetPosition(cam, preset);
    await sleep(5000);
    const out = path.join(OUTDIR, `preset_${preset}.jpg`);
    const ok = await grabWithRetry(driver, out);
    console.log(ok ? `  SAVED preset_${preset}.jpg` : `  FAILED preset_${preset}`);
  }

  const killer = setTimeout(() => process.exit(0), 6000);
  try { await driver.close(); } catch {}
  clearTimeout(killer);
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
