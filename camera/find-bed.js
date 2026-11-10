// Find the bed: recall preset 2, pan right N steps, capture, save.
// usage: node find-bed.js <rightSteps> [serial]
const { EufySecurity } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(fs.readFileSync('/homebridge/config.json', 'utf8'));
const eufy = cfg.platforms.find(p => p.platform === 'EufySecurity');
const STEPS = parseInt(process.argv[2] || '3', 10);
const SERIAL = process.argv[3] || 'T8171T1025090F93';
const OUT = process.argv[4] || '/tmp/find-bed.jpg';

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
    function onStart(_s, _d, m, videostream) {
      ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'h264', '-i', 'pipe:0', '-frames:v', '1', '-q:v', '2', outPath]);
      videostream.pipe(ff.stdin);
      ff.on('close', () => { cleanup(); resolve(fs.existsSync(outPath) && fs.statSync(outPath).size > 0); });
      ff.on('error', () => { cleanup(); resolve(false); });
    }
    driver.on('station livestream start', onStart);
    driver.startStationLivestream(SERIAL).then(() => console.log('livestream requested')).catch(e => { console.log('livestream err', e.message); cleanup(); resolve(false); });
  });
}

async function grabWithRetry(driver, outPath, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    if (await grabFrame(driver, outPath)) return true;
    console.log(`attempt ${i + 1}/${attempts} failed — retrying`);
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
  console.log('connected');

  console.log('recalling preset 2 (bed reference)...');
  await station.presetPosition(cam, 1);
  await sleep(5000);

  console.log(`panning right ${STEPS} steps...`);
  for (let i = 0; i < STEPS; i++) {
    await station.panAndTilt(cam, 2); // 2 = right
    console.log(`  right ${i + 1}/${STEPS}`);
    await sleep(2000);
  }
  await sleep(3000);

  const ok = await grabWithRetry(driver, OUT);
  console.log(ok ? ('SAVED ' + OUT) : 'FAILED');
  const killer = setTimeout(() => process.exit(0), 6000);
  try { await driver.close(); } catch {}
  clearTimeout(killer);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
