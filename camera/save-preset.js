// save-preset.js: save the camera's CURRENT position as a preset slot.
// usage: node save-preset.js <preset:0=PRESET_1,1=PRESET_2,2=PRESET_3,3=PRESET_4> [serial]
const { EufySecurity } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync('/homebridge/config.json', 'utf8'));
const eufy = cfg.platforms.find(p => p.platform === 'EufySecurity');
const PRESET = parseInt(process.argv[2] || '1', 10);
const SERIAL = process.argv[3] || 'T8171T1025090F93';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
process.on('uncaughtException', (e) => { if (e && e.code === 'EPIPE') return; console.error('ERR:', e.message); process.exit(1); });

(async () => {
  const driver = await EufySecurity.initialize({
    country: eufy.country || 'US', language: 'en',
    username: eufy.username, password: eufy.password,
    persistentDir: '/homebridge/eufysecurity',
  });
  await driver.connect();
  const device = await driver.getDevice(SERIAL);
  const station = await driver.getStation(device.getStationSerial());
  let connected = false;
  for (let i = 0; i < 40; i++) { connected = station.isConnected(); if (connected) break; await sleep(1000); }
  if (!connected) { console.log('NOT CONNECTED'); process.exit(1); }

  station.savePresetPosition(device, PRESET);
  await sleep(2000);
  console.log(`SAVED preset=${PRESET}`);
  try { await driver.close(); } catch {}
  setTimeout(() => process.exit(0), 1500);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
