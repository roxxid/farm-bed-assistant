// pos-read.js: decode the camera's position-related raw properties + full 6013 blob.
const { EufySecurity } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync('/homebridge/config.json', 'utf8'));
const eufy = cfg.platforms.find(p => p.platform === 'EufySecurity');
const SERIAL = process.argv[2] || 'T8171T1025090F93';
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
  console.log('connected:', connected);

  const raw = device.getRawProperties();
  const codes = ['1191', '1192', '1193', '1197', '1198', '1202', '1204', '1205', '1207', '1210', '1225', '1239', '1249', '1250', '1276', '1277', '1286', '1294', '1309', '6027', '6028', '6010', '6011', '6012', '6013', '6014'];
  console.log('\n=== interesting raw props ===');
  for (const c of codes) {
    const v = raw[c];
    console.log(`  ${c} = ${v ? JSON.stringify(v.value) : '(absent)'}`);
  }

  // decode 6013 (base64 JSON blob)
  const b = raw['6013'];
  if (b && b.value) {
    try {
      const json = Buffer.from(b.value, 'base64').toString('utf8');
      console.log('\n=== 6013 DECODED ===');
      console.log(json.slice(0, 2000));
    } catch (e) {
      console.log('\n=== 6013 raw value (not base64) ===');
      console.log(b.value.slice(0, 2000));
    }
  }

  try { await driver.close(); } catch {}
  setTimeout(() => process.exit(0), 2000);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
