/**
 * Kestra에서 호출 — 파이프라인 이벤트를 Redis에 발행
 *
 * 사용법:
 *   node scripts/redis_publisher.js \
 *     --channel msit:pipeline:events \
 *     --status success \
 *     --flow msit_datamap_pipeline \
 *     --execution abc123
 */

require('dotenv').config();
const { createClient } = require('redis');
const logger = require('../utils/logger');

function getArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const channel  = getArg('--channel')    || 'msit:pipeline:events';
  const status   = getArg('--status')     || 'unknown';
  const flow     = getArg('--flow')       || '';
  const execution = getArg('--execution') || '';
  const task     = getArg('--task')       || '';

  const payload = JSON.stringify({
    status,
    flow,
    execution,
    task,
    timestamp: new Date().toISOString(),
  });

  const client = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
  client.on('error', (err) => logger.error({ err }, 'Redis 연결 오류'));

  await client.connect();

  const subscribers = await client.publish(channel, payload);
  logger.info({ channel, status, flow, execution, subscribers }, 'Redis 이벤트 발행 완료');

  await client.disconnect();
}

main().catch((err) => {
  logger.fatal({ err }, 'redis_publisher 오류');
  process.exit(1);
});
