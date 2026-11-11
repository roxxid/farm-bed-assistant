// camera-move.js: pan/tilt the camera via CMD_SET_PAYLOAD(1350) + inner 6030.
// This is the working envelope for the E30 (CMD_DOORBELL_SET_PAYLOAD 1700 is ignored for directional pan).
// usage: node camera-move.js <rotate_type:1=left,2=right,3=up,4=down> <steps> [serial]
const { EufySecurity } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync('/homebridge/config.json', 'utf8'));
const eufy = cfg.platforms.find(p => p.platform === 'EufySecurity');
const DIR = parseInt(process.argv[2] || '2', 10);   // 1=left, 2=right, 3=up, 4=down
const STEPS = parseInt(process.argv[3] || '1', 10);
const SERIAL = process.argv[4] || 'T8171T1025090F93';

const CMD_SET_PAYLOAD = 1350;
const CMD_INDOOR_ROTATE = 6030;
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

  const adminId = (station.rawStation && station.rawStation.member && station.rawStation.member.admin_user_id) || '';
  for (let i = 0; i < STEPS; i++) {
    station.p2pSession.sendCommandWithStringPayload({
      commandType: CMD_SET_PAYLOAD,
      value: JSON.stringify({
        account_id: adminId,
        cmd: CMD_INDOOR_ROTATE,
        mChannel: device.getChannel(),
        mValue3: 0,
        payload: { cmd_type: 1, rotate_type: DIR },
      }),
      channel: device.getChannel(),
    }, {});
    await sleep(350);
  }
  await sleep(1500);
  console.log(`MOVED dir=${DIR} steps=${STEPS}`);
  try { await driver.close(); } catch {}
  setTimeout(() => process.exit(0), 1500);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
