// save-and-recall.js: read current position, save to PRESET_1, move away, recall, verify.
// usage: node save-and-recall.js [serial]
const { EufySecurity } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client');
const { spawn } = require('child_process');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync('/homebridge/config.json', 'utf8'));
const eufy = cfg.platforms.find(p => p.platform === 'EufySecurity');
const SERIAL = process.argv[2] || 'T8171T1025090F93';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
process.on('uncaughtException', (e) => { if (e && e.code === 'EPIPE') return; console.error('ERR:', e.message); process.exit(1); });

const POS_CODES = ['1191', '1192', '1193', '6027', '6028'];

function posSnapshot(device) {
  const raw = device.getRawProperties();
  const o = {};
  for (const c of POS_CODES) o[c] = raw[c] ? raw[c].value : null;
  return o;
}

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

function pan(device, station, dir, steps) {
  const adminId = (station.rawStation && station.rawStation.member && station.rawStation.member.admin_user_id) || '';
  for (let i = 0; i < steps; i++) {
    station.p2pSession.sendCommandWithStringPayload({
      commandType: 1350, // CMD_SET_PAYLOAD
      value: JSON.stringify({
        account_id: adminId,
        cmd: 6030, // CMD_INDOOR_ROTATE
        mChannel: device.getChannel(),
        mValue3: 0,
        payload: { cmd_type: 1, rotate_type: dir },
      }),
      channel: device.getChannel(),
    }, {});
  }
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

  // 1. read + log the TARGET position
  const target = posSnapshot(device);
  console.log('TARGET position:', JSON.stringify(target));

  // 2. capture the target view (reference)
  await grabWithRetry(driver, '/tmp/target.jpg');
  console.log('captured target view:', fs.existsSync('/tmp/target.jpg'));

  // 3. save current position to PRESET_1
  await station.savePresetPosition(device, 0); // 0 = PRESET_1
  console.log('saved PRESET_1');
  await sleep(2000);

  // 4. move away (pan right 10)
  pan(device, station, 2, 10);
  await sleep(5000);
  const away = posSnapshot(device);
  console.log('AWAY position:', JSON.stringify(away));

  // 5. recall PRESET_1
  await station.presetPosition(device, 0);
  console.log('recalled PRESET_1');
  await sleep(8000);
  const returned = posSnapshot(device);
  console.log('RETURNED position:', JSON.stringify(returned));

  // 6. capture the returned view
  await grabWithRetry(driver, '/tmp/returned.jpg');
  console.log('captured returned view:', fs.existsSync('/tmp/returned.jpg'));

  // 7. compare
  const match = JSON.stringify(target) === JSON.stringify(returned);
  console.log('POSITION_MATCH:', match, '(target vs returned)');

  try { await driver.close(); } catch {}
  setTimeout(() => process.exit(0), 2000);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
