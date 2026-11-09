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
  await driver.close();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
