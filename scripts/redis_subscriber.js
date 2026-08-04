/**
 * Redis 구독 → Slack 알림 전달
 *
 * 파이프라인이 실행되는 환경에서 항상 켜두는 프로세스.
 * Kestra가 redis_publisher.js로 이벤트를 발행하면 이쪽에서 받아 Slack으로 전송.
 *
 * 실행:
 *   node scripts/redis_subscriber.js
 */

require('dotenv').config();
const { createClient } = require('redis');
const logger = require('../utils/logger');

const CHANNEL  = process.env.REDIS_CHANNEL  || 'msit:pipeline:events';
const REDIS_URL = process.env.REDIS_URL     || 'redis://localhost:6379';
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const KESTRA_BASE_URL   = process.env.KESTRA_BASE_URL || 'http://localhost:8080';

if (!SLACK_WEBHOOK_URL) {
  logger.warn('SLACK_WEBHOOK_URL 환경변수가 없습니다. Slack 알림이 전송되지 않습니다.');
}

function statusEmoji(status) {
  return status === 'success' ? ':large_green_circle:' : ':red_circle:';
}

function statusLabel(status) {
  return status === 'success' ? '완료' : '실패';
}

function buildSlackPayload(event) {
  const { status, flow, execution, task, timestamp } = event;

  const kst = new Date(timestamp).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const kestraUrl = execution
    ? `${KESTRA_BASE_URL}/ui/executions/${flow}/${execution}`
    : KESTRA_BASE_URL;

  const lines = [
    `${statusEmoji(status)} *${flow}* ${statusLabel(status)}`,
    `실행ID: \`${execution}\``,
    task ? `실패태스크: \`${task}\`` : null,
    `시각: ${kst}`,
    `<${kestraUrl}|Kestra에서 보기>`,
  ].filter(Boolean);

  return JSON.stringify({ text: lines.join('\n') });
}

async function sendSlack(payload) {
  if (!SLACK_WEBHOOK_URL) return;

  const response = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  });

  if (!response.ok) {
    throw new Error(`Slack 응답 오류: ${response.status}`);
  }
}

async function main() {
  const subscriber = createClient({ url: REDIS_URL });
  subscriber.on('error', (err) => logger.error({ err }, 'Redis 구독자 연결 오류'));

  await subscriber.connect();
  logger.info({ channel: CHANNEL }, 'Redis 구독 시작');

  await subscriber.subscribe(CHANNEL, async (message) => {
    let event;

    try {
      event = JSON.parse(message);
    } catch {
      logger.warn({ message }, '메시지 파싱 실패');
      return;
    }

    logger.info({ event }, '이벤트 수신');

    try {
      const payload = buildSlackPayload(event);
      await sendSlack(payload);
      logger.info({ status: event.status }, 'Slack 알림 전송 완료');
    } catch (err) {
      logger.error({ err }, 'Slack 알림 전송 실패');
    }
  });

  // 프로세스 종료 처리
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      logger.info({ signal }, '구독자 종료');
      await subscriber.unsubscribe(CHANNEL);
      await subscriber.disconnect();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  logger.fatal({ err }, 'redis_subscriber 오류');
  process.exit(1);
});
