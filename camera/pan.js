// Pan/tilt a Eufy camera. usage: node pan.js <direction> [serial]
// direction: 0=rotate360, 1=left, 2=right, 3=up, 4=down
const { EufySecurity } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync('/homebridge/config.json', 'utf8'));
const eufy = cfg.platforms.find(p => p.platform === 'EufySecurity');
const dir = parseInt(process.argv[2] || '1', 10);
const SERIAL = process.argv[3] || 'T8171T1025090F93'; // Backyard

(async () => {
  const driver = await EufySecurity.initialize({
    country: eufy.country || 'US', language: 'en',
    username: eufy.username, password: eufy.password,
    persistentDir: '/homebridge/eufysecurity',
  });
  await driver.connect();
  const cam = await driver.getDevice(SERIAL);
  const station = await driver.getStation(cam.getStationSerial());
  console.log('station:', station.getName(), '| camera:', cam.getName(), '| hasPanAndTilt:', cam.hasCommand('devicePanAndTilt'));
  await station.panAndTilt(cam, dir);
  console.log('PAN/TILT SENT: direction', dir);
  // close the station P2P session cleanly so it doesn't block the next livestream;
  // guard with a hard timeout because P2P teardown can hang.
  const killer = setTimeout(() => process.exit(0), 6000);
  try { await station.close(); } catch (e) {}
  clearTimeout(killer);
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
