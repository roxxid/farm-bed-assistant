// log-pan.js: run a pan command with the client's P2P/HTTP logging enabled,
// to see whether the command is actually sent and acknowledged.
const { EufySecurity } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client');
const { LogLevel } = require('/homebridge/node_modules/@homebridge-plugins/homebridge-eufy-security/node_modules/eufy-security-client/build/logging');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync('/homebridge/config.json', 'utf8'));
const eufy = cfg.platforms.find(p => p.platform === 'EufySecurity');
const SERIAL = 'T8171T1025090F93';
const DIR = parseInt(process.argv[2] || '1', 10);
const STEPS = parseInt(process.argv[3] || '3', 10);

const consoleLogger = {
  trace: (...a) => console.log('TRACE', ...a),
  debug: (...a) => console.log('DEBUG', ...a),
  info: (...a) => console.log('INFO', ...a),
  warn: (...a) => console.log('WARN', ...a),
  error: (...a) => console.log('ERROR', ...a),
  fatal: (...a) => console.log('FATAL', ...a),
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const driver = await EufySecurity.initialize({
    country: eufy.country || 'US', language: 'en',
    username: eufy.username, password: eufy.password,
    persistentDir: '/homebridge/eufysecurity',
    logging: {
      level: LogLevel.Debug,
      categories: [
        { category: 'p2p', level: LogLevel.Trace },
        { category: 'http', level: LogLevel.Debug },
        { category: 'main', level: LogLevel.Debug },
      ],
    },
  }, consoleLogger);
  await driver.connect();
  const cam = await driver.getDevice(SERIAL);
  const station = await driver.getStation(cam.getStationSerial());
  console.log('--- got station:', station.getName());

  const t0 = Date.now();
  while (!station.isConnected() && Date.now() - t0 < 30000) await sleep(500);
  console.log('--- station.isConnected():', station.isConnected());
  console.log('--- station.isLiveStreaming():', station.isLiveStreaming(cam));
  console.log('--- hasCommand devicePanAndTilt:', cam.hasCommand('devicePanAndTilt'));

  console.log(`--- sending panAndTilt dir=${DIR} x${STEPS} ---`);
  for (let i = 0; i < STEPS; i++) {
    station.panAndTilt(cam, DIR);
    await sleep(1500);
  }
  console.log('--- pan commands sent, waiting 5s for any response... ---');
  await sleep(5000);

  const killer = setTimeout(() => process.exit(0), 5000);
  try { await driver.close(); } catch {}
  clearTimeout(killer);
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message, e.stack); process.exit(1); });
