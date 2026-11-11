// sweep.js: rotate the camera (360° cruise) and capture frames through the sweep.
// The bed is captured wherever it sits in the rotation — no preset/position guessing.
// usage: node sweep.js [serial] [outDir] [frames]
const { EufySecurity } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client');
const { spawn } = require('child_process');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync('/homebridge/config.json', 'utf8'));
const eufy = cfg.platforms.find(p => p.platform === 'EufySecurity');
const SERIAL = process.argv[2] || 'T8171T1025090F93';
const OUTDIR = process.argv[3] || '/tmp/sweep';
const FRAMES = parseInt(process.argv[4] || '14', 10);
const TILT_DOWN = parseInt(process.argv[5] || '4', 10);  // curise_type=4 (tilt down) steps from the top
const PAN_LEFT = parseInt(process.argv[6] || '2', 10);   // curise_type=1 (pan left) extra steps
const TILT_UP_RESET = parseInt(process.argv[7] || '8', 10); // curise_type=3 (tilt up) to reset to the top first

const CMD_DOORBELL_SET_PAYLOAD = 1700;
const CMD_OUTDOOR_ROTATE = 6038;

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
  console.log('waiting for station connection...');
  let connected = false;
  for (let i = 0; i < 40; i++) { connected = station.isConnected(); if (connected) break; await sleep(1000); }
  console.log('station connected:', connected);
  if (!connected) { console.log('NOT CONNECTED'); process.exit(1); }

  // grab frames continuously during the rotation
  const prefix = `${OUTDIR}/sweep_`;
  let ff = null;
  let done = false;
  const framesGrab = new Promise((resolve) => {
    const timer = setTimeout(() => { if (ff) { try { ff.stdin.end(); } catch {} } resolve(); }, 40000);
    function onStart(_s, _d, _m, videostream) {
      videostream.on('error', () => {});
      // grab FRAMES frames at ~1 fps across the rotation
      ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'h264', '-i', 'pipe:0',
        '-vf', 'fps=1', '-frames:v', String(FRAMES), '-q:v', '2', `${prefix}%03d.jpg`]);
      ff.on('error', () => {});
      ff.on('close', () => { clearTimeout(timer); resolve(); });
      videostream.pipe(ff.stdin);
    }
    driver.on('station livestream start', onStart);
    driver.startStationLivestream(SERIAL).then(() => {}).catch(() => { clearTimeout(timer); resolve(); });
  });

  // wait for the stream to spin up, then reset tilt to the top (known reference)
  await sleep(2000);
  console.log(`resetting tilt up ${TILT_UP_RESET} steps (to top)...`);
  for (let i = 0; i < TILT_UP_RESET; i++) {
    station.p2pSession.sendCommandWithStringPayload({
      commandType: CMD_DOORBELL_SET_PAYLOAD,
      value: JSON.stringify({ commandType: CMD_OUTDOOR_ROTATE, data: { curise_type: 3 } }),
      channel: device.getChannel(),
    }, {});
    await sleep(500);
  }
  await sleep(2000);
  console.log(`tilting down ${TILT_DOWN} steps from top...`);
  for (let i = 0; i < TILT_DOWN; i++) {
    station.p2pSession.sendCommandWithStringPayload({
      commandType: CMD_DOORBELL_SET_PAYLOAD,
      value: JSON.stringify({ commandType: CMD_OUTDOOR_ROTATE, data: { curise_type: 4 } }),
      channel: device.getChannel(),
    }, {});
    await sleep(500);
  }
  await sleep(1500);
  console.log(`panning left ${PAN_LEFT} extra step(s)...`);
  for (let i = 0; i < PAN_LEFT; i++) {
    station.p2pSession.sendCommandWithStringPayload({
      commandType: CMD_DOORBELL_SET_PAYLOAD,
      value: JSON.stringify({ commandType: CMD_OUTDOOR_ROTATE, data: { curise_type: 1 } }),
      channel: device.getChannel(),
    }, {});
    await sleep(500);
  }
  await sleep(2000);
  console.log('starting 360° rotation...');
  station.p2pSession.sendCommandWithStringPayload({
    commandType: CMD_DOORBELL_SET_PAYLOAD,
    value: JSON.stringify({ commandType: CMD_OUTDOOR_ROTATE, data: { curise_type: 10 } }),
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
