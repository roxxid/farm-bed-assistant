// pos-verify.js: read position, pan right N (with per-step delay), read again.
const { EufySecurity } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync('/homebridge/config.json', 'utf8'));
const eufy = cfg.platforms.find(p => p.platform === 'EufySecurity');
const SERIAL = process.argv[2] || 'T8171T1025090F93';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
process.on('uncaughtException', (e) => { if (e && e.code === 'EPIPE') return; console.error('ERR:', e.message); process.exit(1); });

const pos = (device) => {
  const raw = device.getRawProperties();
  return { p: raw['1192'] ? raw['1192'].value : null, t: raw['1193'] ? raw['1193'].value : null };
};

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

  console.log('BEFORE:', JSON.stringify(pos(device)));

  const adminId = (station.rawStation && station.rawStation.member && station.rawStation.member.admin_user_id) || '';
  for (let i = 0; i < 5; i++) {
    station.p2pSession.sendCommandWithStringPayload({
      commandType: 1350,
      value: JSON.stringify({
        account_id: adminId, cmd: 6030, mChannel: device.getChannel(), mValue3: 0,
        payload: { cmd_type: 1, rotate_type: 2 }, // right
      }),
      channel: device.getChannel(),
    }, {});
    await sleep(350);
  }
  await sleep(6000);
  console.log('AFTER (right 5):', JSON.stringify(pos(device)));

  try { await driver.close(); } catch {}
  setTimeout(() => process.exit(0), 1500);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
