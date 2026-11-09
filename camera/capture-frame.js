// Grab a fresh JPEG frame from a Eufy camera via P2P livestream + ffmpeg.
// Usage: node capture-frame.js <serial> <output.jpg>
// Requires: run inside the homebridge container (has eufy-security-client + ffmpeg).
const { EufySecurity } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client');
const { spawn } = require('child_process');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync('/homebridge/config.json', 'utf8'));
const eufy = cfg.platforms.find(p => p.platform === 'EufySecurity');
const SERIAL = process.argv[2] || 'T8171T1025090F93'; // Backyard
const OUT = process.argv[3] || '/tmp/snap.jpg';

(async () => {
  const driver = await EufySecurity.initialize({
    country: eufy.country || 'US', language: 'en',
    username: eufy.username, password: eufy.password,
    persistentDir: '/homebridge/eufysecurity',
  });
  await driver.connect();

  driver.on('station livestream start', (station, device, metadata, videostream, audiostream) => {
    const ff = spawn('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'h264', '-i', 'pipe:0',
      '-frames:v', '1', '-q:v', '2', OUT,
    ]);
    videostream.pipe(ff.stdin);
    let done = false;
    ff.on('close', async (code) => {
      if (done) return; done = true;
      try { await driver.stopStationLivestream(SERIAL); } catch {}
      await driver.close();
      const size = fs.existsSync(OUT) ? fs.statSync(OUT).size : 0;
      console.log('SNAPSHOT_SAVED', OUT, size, 'bytes');
      process.exit(size > 0 ? 0 : 2);
    });
  });

  await driver.startStationLivestream(SERIAL);
  setTimeout(() => { console.log('TIMEOUT waiting for frame'); process.exit(1); }, 60000);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
