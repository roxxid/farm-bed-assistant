// pan-payload.js: test CMD_SET_PAYLOAD (1350) envelope + inner 6030 directional rotate.
// usage: node pan-payload.js <rotate_type:1=left,2=right,3=up,4=down> <steps>
const { EufySecurity } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync('/homebridge/config.json', 'utf8'));
const eufy = cfg.platforms.find(p => p.platform === 'EufySecurity');
const SERIAL = 'T8171T1025090F93';
const DIR = parseInt(process.argv[2] || '2', 10);   // rotate_type
const STEPS = parseInt(process.argv[3] || '5', 10); // cmd_type

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
process.on('uncaughtException', (e) => { if (e && e.code === 'EPIPE') return; console.error('UNCAUGHT:', e.message); process.exit(1); });
const md5 = (p) => fs.existsSync(p) ? crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex').slice(0, 12) : 'none';

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
async function grabWithRetry(driver, outPath, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    if (await grabFrame(driver, outPath)) return true;
    try { await driver.stopStationLivestream(SERIAL); } catch {}
    await sleep(6000);
  }
  return false;
}

(async () => {
  const driver = await EufySecurity.initialize({ country: eufy.country || 'US', language: 'en', username: eufy.username, password: eufy.password, persistentDir: '/homebridge/eufysecurity' });
  await driver.connect();
  driver.setCameraMaxLivestreamDuration(150);
  const device = await driver.getDevice(SERIAL);
  const station = await driver.getStation(device.getStationSerial());
  let connected = false;
  for (let i = 0; i < 40; i++) { connected = station.isConnected(); if (connected) break; await sleep(1000); }
  console.log('connected:', connected);

  console.log('capturing baseline...');
  await grabWithRetry(driver, '/tmp/pp-before.jpg');
  console.log('baseline md5:', md5('/tmp/pp-before.jpg'));

  const adminId = (station.rawStation && station.rawStation.member && station.rawStation.member.admin_user_id) || '';
  console.log(`sending CMD_SET_PAYLOAD(1350) inner 6030 rotate_type=${DIR} cmd_type=${STEPS}...`);
  for (let i = 0; i < 3; i++) {
    station.p2pSession.sendCommandWithStringPayload({
      commandType: 1350, // CMD_SET_PAYLOAD
      value: JSON.stringify({
        account_id: adminId,
        cmd: 6030, // CMD_INDOOR_ROTATE
        mChannel: device.getChannel(),
        mValue3: 0,
        payload: { cmd_type: STEPS, rotate_type: DIR },
      }),
      channel: device.getChannel(),
    }, {});
    await sleep(500);
  }
  await sleep(8000);

  console.log('capturing after...');
  await grabWithRetry(driver, '/tmp/pp-after.jpg');
  console.log('after md5:', md5('/tmp/pp-after.jpg'));
  console.log('CAMERA_MOVED:', md5('/tmp/pp-before.jpg') !== md5('/tmp/pp-after.jpg'));
  try { await driver.close(); } catch {}
  setTimeout(() => process.exit(0), 2000);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
