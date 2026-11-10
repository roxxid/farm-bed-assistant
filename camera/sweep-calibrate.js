// sweep-calibrate.js: recall preset 2, pan right through the range, capture a
// time-lapse (one livestream), and report how many frames were captured.
// usage: node sweep-calibrate.js [steps] [serial]
const { EufySecurity } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(fs.readFileSync('/homebridge/config.json', 'utf8'));
const eufy = cfg.platforms.find(p => p.platform === 'EufySecurity');
const STEPS = parseInt(process.argv[2] || '18', 10);
const SERIAL = process.argv[3] || 'T8171T1025090F93';
const OUTDIR = process.argv[4] || '/tmp/sweep';
const INTERVAL = 2000; // ms between pan steps

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const driver = await EufySecurity.initialize({
    country: eufy.country || 'US', language: 'en',
    username: eufy.username, password: eufy.password,
    persistentDir: '/homebridge/eufysecurity',
  });
  await driver.connect();
  const cam = await driver.getDevice(SERIAL);
  const station = await driver.getStation(cam.getStationSerial());
  driver.setCameraMaxLivestreamDuration(300);
  fs.rmSync(OUTDIR, { recursive: true, force: true });
  fs.mkdirSync(OUTDIR, { recursive: true });

  console.log('recalling preset 2...');
  await station.presetPosition(cam, 1);
  await sleep(4000);

  // start livestream, then pan while ffmpeg grabs a frame every INTERVAL ms
  let ff = null;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('livestream start timeout')), 60000);
    driver.on('station livestream start', (_s, _d, _m, videostream) => {
      clearTimeout(timer);
      ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'h264', '-i', 'pipe:0',
        '-vf', 'fps=1/2', '-q:v', '2', path.join(OUTDIR, 'f_%03d.jpg')]);
      videostream.pipe(ff.stdin);
      resolve();
    });
    driver.startStationLivestream(SERIAL).catch(reject);
  });
  console.log('livestream active — panning right...');

  for (let i = 0; i < STEPS; i++) {
    await station.panAndTilt(cam, 2); // 2 = right
    console.log(`  right ${i + 1}/${STEPS}`);
    await sleep(INTERVAL);
  }

  if (ff) { try { ff.stdin.end(); } catch {} }
  await sleep(1500);
  try { await driver.stopStationLivestream(SERIAL); } catch {}

  const frames = fs.readdirSync(OUTDIR).filter(f => f.endsWith('.jpg')).sort();
  console.log('FRAME_COUNT', frames.length);
  console.log('FRAMES', frames.join(','));
  const killer = setTimeout(() => process.exit(0), 6000);
  try { await driver.close(); } catch {}
  clearTimeout(killer);
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
