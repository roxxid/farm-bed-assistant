// pan-diff-test.js: connect, WAIT for station P2P connection, pan, and compare
// two captures (baseline vs after-pan) via MD5 to prove whether the camera moves.
const { EufySecurity } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client');
const { spawn } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

const cfg = JSON.parse(fs.readFileSync('/homebridge/config.json', 'utf8'));
const eufy = cfg.platforms.find(p => p.platform === 'EufySecurity');
const SERIAL = 'T8171T1025090F93';
const DIR = parseInt(process.argv[2] || '4', 10); // 4=down default
const STEPS = parseInt(process.argv[3] || '4', 10);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');

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

async function waitForStation(station, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (station.isConnected()) return true;
    await sleep(500);
  }
  return false;
}

async function grabWithRetry(driver, outPath, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    if (await grabFrame(driver, outPath)) return true;
    console.log(`  grab attempt ${i + 1}/${attempts} failed`);
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

  console.log('station.isConnected() immediately after connect:', station.isConnected());
  const connected = await waitForStation(station);
  console.log('station connected after wait:', connected);

  // baseline capture
  console.log('capturing baseline...');
  await grabWithRetry(driver, '/tmp/baseline.jpg');
  await sleep(3000);

  // pan
  console.log(`panning dir ${DIR} x${STEPS}...`);
  for (let i = 0; i < STEPS; i++) {
    await station.panAndTilt(cam, DIR);
    await sleep(2000);
  }
  await sleep(3000);

  // after-pan capture
  console.log('capturing after-pan...');
  await grabWithRetry(driver, '/tmp/afterpan.jpg');

  if (fs.existsSync('/tmp/baseline.jpg') && fs.existsSync('/tmp/afterpan.jpg')) {
    const h1 = md5('/tmp/baseline.jpg');
    const h2 = md5('/tmp/afterpan.jpg');
    console.log('baseline md5:', h1);
    console.log('afterpan md5:', h2);
    console.log('CAMERA_MOVED:', h1 !== h2);
  } else {
    console.log('CAPTURE FAILED — missing files');
  }

  const killer = setTimeout(() => process.exit(0), 6000);
  try { await driver.close(); } catch {}
  clearTimeout(killer);
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
