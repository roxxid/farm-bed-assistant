// recall-test.js: recall PRESET_1 and capture the resulting view.
const { EufySecurity } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client');
const { spawn } = require('child_process');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync('/homebridge/config.json', 'utf8'));
const eufy = cfg.platforms.find(p => p.platform === 'EufySecurity');
const SERIAL = process.argv[2] || 'T8171T1025090F93';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
process.on('uncaughtException', (e) => { if (e && e.code === 'EPIPE') return; console.error('ERR:', e.message); process.exit(1); });

function grabFrame(driver, outPath, timeoutMs = 30000) {
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
    try { await driver.stopStationLivestream(SERIAL); } catch {}
    await sleep(8000);
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
  let connected = false;
  for (let i = 0; i < 40; i++) { connected = station.isConnected(); if (connected) break; await sleep(1000); }
  console.log('connected:', connected);

  const raw = device.getRawProperties();
  console.log('POS before recall: p(1192)=', raw['1192'] && raw['1192'].value, ' t(1193)=', raw['1193'] && raw['1193'].value);

  await station.presetPosition(device, 0); // recall PRESET_1
  console.log('recalled PRESET_1');
  await sleep(10000);

  console.log('capturing recalled view...');
  const ok = await grabWithRetry(driver, '/tmp/recalled.jpg');
  console.log('captured:', ok);
  if (ok) { console.log('RECALLED_VIEW /tmp/recalled.jpg'); }

  try { await driver.close(); } catch {}
  setTimeout(() => process.exit(0), 2000);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
