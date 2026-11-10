// capture-bed.js: full bed-shot flow — recall bed preset → capture → return to backyard preset.
// usage: node capture-bed.js [serial] [outPath] [bedPreset] [backyardPreset]
const { EufySecurity } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client');
const { spawn } = require('child_process');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync('/homebridge/config.json', 'utf8'));
const eufy = cfg.platforms.find(p => p.platform === 'EufySecurity');
const SERIAL = process.argv[2] || 'T8171T1025090F93';
const OUT = process.argv[3] || '/tmp/bed-shot.jpg';
const BED_PRESET = parseInt(process.argv[4] || '2', 10);
const BACKYARD_PRESET = parseInt(process.argv[5] || '1', 10);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
process.on('uncaughtException', (e) => { if (e && e.code === 'EPIPE') return; console.error('UNCAUGHT:', e.message); process.exit(1); });

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
    driver.startStationLivestream(SERIAL).then(() => {}).catch(() => { cleanup(); resolve(false); });
  });
}

async function grabWithRetry(driver, outPath, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    if (await grabFrame(driver, outPath)) return true;
    console.log(`  capture attempt ${i + 1}/${attempts} failed`);
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
  driver.setCameraMaxLivestreamDuration(120);

  const device = await driver.getDevice(SERIAL);
  const station = await driver.getStation(device.getStationSerial());
  console.log('waiting for station connection...');
  let connected = false;
  for (let i = 0; i < 40; i++) { connected = station.isConnected(); if (connected) break; await sleep(1000); }
  console.log('station connected:', connected);
  if (!connected) { console.log('NOT CONNECTED'); process.exit(1); }

  // 1. go to the bed
  console.log(`recalling bed preset ${BED_PRESET}...`);
  station.presetPosition(device, BED_PRESET);
  await sleep(9000);

  // 2. capture the bed
  console.log('capturing bed...');
  const ok = await grabWithRetry(driver, OUT);

  // 3. return to backyard
  console.log(`returning to backyard preset ${BACKYARD_PRESET}...`);
  station.presetPosition(device, BACKYARD_PRESET);
  await sleep(3000);

  console.log(ok ? ('SAVED ' + OUT) : 'CAPTURE FAILED');
  try { await driver.close(); } catch {}
  setTimeout(() => process.exit(ok ? 0 : 1), 2000);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
