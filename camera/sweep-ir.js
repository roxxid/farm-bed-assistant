// sweep-ir.js: force IR (B&W night vision) then run the 360° sweep capture.
// usage: node sweep-ir.js [serial] [outDir] [frames] [fps]
const { EufySecurity } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client');
const { spawn } = require('child_process');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync('/homebridge/config.json', 'utf8'));
const eufy = cfg.platforms.find(p => p.platform === 'EufySecurity');
const SERIAL = process.argv[2] || 'T8171T1025090F93';
const OUTDIR = process.argv[3] || '/tmp/sweep';
const FRAMES = parseInt(process.argv[4] || '52', 10);
const FPS = parseInt(process.argv[5] || '2', 10);

const CMD_SET_PAYLOAD = 1350;
const CMD_SET_NIGHT_VISION_TYPE = 1277;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
process.on('uncaughtException', (e) => { if (e && e.code === 'EPIPE') return; console.error('UNCAUGHT:', e.message); process.exit(1); });

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const driver = await EufySecurity.initialize({
    country: eufy.country || 'US', language: 'en',
    username: eufy.username, password: eufy.password,
    persistentDir: '/homebridge/eufysecurity',
  });
  await driver.connect();
  driver.setCameraMaxLivestreamDuration(180);

  const device = await driver.getDevice(SERIAL);
  const station = await driver.getStation(device.getStationSerial());
  let connected = false;
  for (let i = 0; i < 40; i++) { connected = station.isConnected(); if (connected) break; await sleep(1000); }
  console.log('station connected:', connected);
  if (!connected) { process.exit(1); }

  // force IR night vision (B&W)
  const adminId = (station.rawStation && station.rawStation.member && station.rawStation.member.admin_user_id) || '';
  console.log('forcing IR night vision (night_sion=1)...');
  station.p2pSession.sendCommandWithStringPayload({
    commandType: CMD_SET_PAYLOAD,
    value: JSON.stringify({
      account_id: adminId,
      cmd: CMD_SET_NIGHT_VISION_TYPE,
      mValue3: 0,
      payload: { channel: device.getChannel(), night_sion: 1 },
    }),
    channel: device.getChannel(),
  }, {});
  await sleep(4000); // let the IR LEDs switch on

  // capture frames across the rotation
  const prefix = `${OUTDIR}/sweep_`;
  const framesGrab = new Promise((resolve) => {
    const timer = setTimeout(() => { if (ff) { try { ff.stdin.end(); } catch {} } resolve(); }, 45000);
    let ff = null;
    function onStart(_s, _d, _m, videostream) {
      videostream.on('error', () => {});
      ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'h264', '-i', 'pipe:0',
        '-vf', `fps=${FPS}`, '-frames:v', String(FRAMES), '-q:v', '2', `${prefix}%03d.jpg`]);
      ff.on('error', () => {});
      ff.on('close', () => { clearTimeout(timer); resolve(); });
      videostream.pipe(ff.stdin);
    }
    driver.on('station livestream start', onStart);
    driver.startStationLivestream(SERIAL).then(() => {}).catch(() => { clearTimeout(timer); resolve(); });
  });

  await sleep(3000);
  console.log('starting 360° rotation...');
  station.p2pSession.sendCommandWithStringPayload({
    commandType: 1700, // CMD_DOORBELL_SET_PAYLOAD
    value: JSON.stringify({ commandType: 6038, data: { curise_type: 10 } }),
    channel: device.getChannel(),
  }, {});

  await framesGrab;
  console.log('rotation capture finished');
  try { await driver.stopStationLivestream(SERIAL); } catch {}
  try { await driver.close(); } catch {}
  const files = fs.readdirSync(OUTDIR).filter(f => f.endsWith('.jpg'));
  console.log('FRAMES:', files.length);
  setTimeout(() => process.exit(files.length ? 0 : 1), 2000);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
