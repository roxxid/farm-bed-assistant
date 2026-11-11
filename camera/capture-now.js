// capture-now.js: capture the CURRENT camera position (no pan, no preset).
// usage: node capture-now.js [serial] [outPath]
const { EufySecurity } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client');
const { spawn } = require('child_process');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync('/homebridge/config.json', 'utf8'));
const eufy = cfg.platforms.find(p => p.platform === 'EufySecurity');
const SERIAL = process.argv[2] || 'T8171T1025090F93';
const OUT = process.argv[3] || '/tmp/capture-now.jpg';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// swallow EPIPE (videostream keeps writing after ffmpeg grabs its 1 frame)
process.on('uncaughtException', (e) => { if (e && e.code === 'EPIPE') return; console.error('UNCAUGHT:', e.message); process.exit(1); });

function grabFrame(driver, outPath, timeoutMs = 40000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
    let ff = null;
    function cleanup() {
      if (ff) { try { ff.stdin.end(); } catch {} }
      clearTimeout(timer);
      driver.off('station livestream start', onStart);
    }
    function onStart(_s, _d, _m, videostream) {
      videostream.on('error', () => {}); // swallow EPIPE
      ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'h264', '-i', 'pipe:0', '-frames:v', '1', '-q:v', '2', outPath]);
      ff.on('error', () => { cleanup(); resolve(false); });
      ff.on('close', () => {
        cleanup();
        const ok = fs.existsSync(outPath) && fs.statSync(outPath).size > 0;
        resolve(ok);
      });
      videostream.pipe(ff.stdin);
    }
    driver.on('station livestream start', onStart);
    driver.startStationLivestream(SERIAL).then(() => {}).catch(e => { console.log('livestream err', e.message); cleanup(); resolve(false); });
  });
}

async function grabWithRetry(driver, outPath, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    if (await grabFrame(driver, outPath)) return true;
    console.log(`attempt ${i + 1}/${attempts} failed — retrying`);
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
  const ok = await grabWithRetry(driver, OUT);
  console.log(ok ? ('SAVED ' + OUT) : 'FAILED');
  const killer = setTimeout(() => process.exit(0), 6000);
  try { await driver.close(); } catch {}
  clearTimeout(killer);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
