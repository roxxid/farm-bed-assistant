// Recall a Eufy camera preset position. usage: node preset.js <position> [serial]
// position: 0=PRESET_1, 1=PRESET_2, 2=PRESET_3, 3=PRESET_4
const { EufySecurity } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync('/homebridge/config.json', 'utf8'));
const eufy = cfg.platforms.find(p => p.platform === 'EufySecurity');
const position = parseInt(process.argv[2] || '1', 10);
const SERIAL = process.argv[3] || 'T8171T1025090F93';

(async () => {
  const driver = await EufySecurity.initialize({
    country: eufy.country || 'US', language: 'en',
    username: eufy.username, password: eufy.password,
    persistentDir: '/homebridge/eufysecurity',
  });
  await driver.connect();
  const cam = await driver.getDevice(SERIAL);
  const station = await driver.getStation(cam.getStationSerial());
  console.log('station:', station.getName(), '| cam:', cam.getName(), '| hasPreset:', cam.hasCommand('devicePresetPosition'));
  await station.presetPosition(cam, position);
  console.log('PRESET RECALLED: position', position);
  const killer = setTimeout(() => process.exit(0), 6000);
  try { await station.close(); } catch {}
  clearTimeout(killer);
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
