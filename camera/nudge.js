// nudge.js: connect, wait for station P2P, pan N steps in a direction, capture.
// usage: node nudge.js <direction> <steps> [serial]
// direction: 1=left 2=right 3=up 4=down
const { EufySecurity } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client');
const { spawn } = require('child_process');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync('/homebridge/config.json', 'utf8'));
const eufy = cfg.platforms.find(p => p.platform === 'EufySecurity');
const DIR = parseInt(process.argv[2] || '2', 10);
const STEPS = parseInt(process.argv[3] || '3', 10);
const SERIAL = process.argv[4] || 'T8171T1025090F93';
const OUT = '/tmp/nudge.jpg';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function grabFrame(driver, outPath, timeoutMs = 40000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
    let ff = null;
    function cleanup() { if (ff) { try { ff.stdin.end(); } catch {} } clearTimeout(timer); driver.off('station livestream start', onStart); }
    function onStart(_s, _d, _m, videostream) {
      videostream.on('error', () => {});
      ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'h264', '-i', 'pipe:0', '-frames:v', '1', '-q:v', '2', outPath]);
      ff.on('error', () => { cleanup(); resolve(false); });
      ff.on('close', () => { cleanup(); resolve(fs.existsSync(outPath) && fs.statSync(outPath).size > 0); });
      videostream.pipe(ff.stdin);
    }
    driver.on('station livestream start', onStart);
    driver.startStationLivestream(SERIAL).catch(e => { console.log('livestream err', e.message); cleanup(); resolve(false); });
  });
}

async function grabWithRetry(driver, outPath, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    if (await grabFrame(driver, outPath)) return true;
    console.log(`grab attempt ${i + 1}/${attempts} failed`);
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

  const t0 = Date.now();
  while (!station.isConnected() && Date.now() - t0 < 30000) await sleep(500);
  console.log('station connected:', station.isConnected());

  console.log(`panning dir ${DIR} x${STEPS}...`);
  for (let i = 0; i < STEPS; i++) {
    await station.panAndTilt(cam, DIR);
    await sleep(1800);
  }
  await sleep(3000);

  const ok = await grabWithRetry(driver, OUT);
  console.log(ok ? ('SAVED ' + OUT) : 'FAILED');

  const killer = setTimeout(() => process.exit(0), 6000);
  try { await driver.close(); } catch {}
  clearTimeout(killer);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
