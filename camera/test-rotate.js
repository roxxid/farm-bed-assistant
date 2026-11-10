// test-rotate.js: send CMD_OUTDOOR_ROTATE with a curise_type value directly
// and compare two captures to see if the camera actually rotates.
const { EufySecurity } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client');
const { CommandType } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client/build/p2p/types');
const { spawn } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

const cfg = JSON.parse(fs.readFileSync('/homebridge/config.json', 'utf8'));
const eufy = cfg.platforms.find(p => p.platform === 'EufySecurity');
const SERIAL = 'T8171T1025090F93';
const CURISE = parseInt(process.argv[2] || '2', 10);

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
    driver.startStationLivestream(SERIAL).catch(e => { cleanup(); resolve(false); });
  });
}

async function grabWithRetry(driver, outPath, attempts = 3) {
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

  const t0 = Date.now();
  while (!station.isConnected() && Date.now() - t0 < 30000) await sleep(500);
  console.log('station connected:', station.isConnected());

  console.log('capturing baseline...');
  await grabWithRetry(driver, '/tmp/rot-base.jpg');
  await sleep(2000);

  console.log(`sending CMD_OUTDOOR_ROTATE curise_type=${CURISE}...`);
  station.p2pSession.sendCommandWithStringPayload({
    commandType: CommandType.CMD_DOORBELL_SET_PAYLOAD,
    value: JSON.stringify({
      commandType: CommandType.CMD_OUTDOOR_ROTATE,
      data: { curise_type: CURISE },
    }),
    channel: cam.getChannel(),
  }, { command: { name: 'devicePanAndTilt', value: 2 } });
  await sleep(6000);

  console.log('capturing after-rotate...');
  await grabWithRetry(driver, '/tmp/rot-after.jpg');

  if (fs.existsSync('/tmp/rot-base.jpg') && fs.existsSync('/tmp/rot-after.jpg')) {
    const h1 = md5('/tmp/rot-base.jpg');
    const h2 = md5('/tmp/rot-after.jpg');
    console.log('baseline md5:', h1);
    console.log('after md5:', h2);
    console.log('CAMERA_MOVED:', h1 !== h2);
  } else {
    console.log('CAPTURE FAILED');
  }

  const killer = setTimeout(() => process.exit(0), 6000);
  try { await driver.close(); } catch {}
  clearTimeout(killer);
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
