// pos-dump.js: dump ALL device properties + raw properties, hunting for current pan/tilt position.
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

  console.log('\n=== PARSED PROPERTIES (position-relevant) ===');
  const props = device.getProperties();
  for (const [k, v] of Object.entries(props)) {
    if (/angle|position|pan|tilt|rotate|degree|default/i.test(k)) {
      console.log(`  ${k} = ${JSON.stringify(v)}`);
    }
  }

  console.log('\n=== RAW PROPERTIES (numbers, position-relevant) ===');
  const raw = device.getRawProperties();
  for (const [k, v] of Object.entries(raw)) {
    if (/angle|position|pan|tilt|rotate|degree|default/i.test(k)) {
      console.log(`  ${k} = ${JSON.stringify(v)}`);
    }
  }

  console.log('\n=== RAW PROPERTIES: 6030 / 6038 / angle-related codes ===');
  for (const [k, v] of Object.entries(raw)) {
    const ks = String(k);
    if (ks === '6030' || ks === '6038' || ks === '1202' || ks === '1203' || ks === '1204' || ks === '1205' || ks === '1206' || ks === '1207' || ks === '1208' || ks === '1209' || ks === '1210' || ks === '1201' || ks === '1211' || ks === '1212' || /curise|rotate|angle|degree/i.test(JSON.stringify(v))) {
      console.log(`  ${ks} = ${JSON.stringify(v)}`);
    }
  }

  console.log('\n=== ALL RAW PROPERTIES (key => value) ===');
  for (const [k, v] of Object.entries(raw)) {
    console.log(`  ${k} = ${JSON.stringify(v)}`);
  }

  try { await driver.close(); } catch {}
  setTimeout(() => process.exit(0), 2000);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
