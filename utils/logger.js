// 한국 시간 강제 적용 (KST)
// Date 객체나 로거가 생성되기 전에 가장 먼저 설정하는 것이 좋음
process.env.TZ = process.env.TZ || 'Asia/Seoul';

const pino = require('pino');
const path = require('path');

// 로그 파일 경로 설정
// 기본값: 프로젝트 루트/logs/pipeline.log
// 필요 시 LOG_FILE 환경변수로 다른 경로를 지정할 수 있음
const logFilePath =
  process.env.LOG_FILE ||
  path.join(process.cwd(), 'logs', 'pipeline.log');

// 로그 레벨 설정
// 기본값은 info이며, 필요 시 LOG_LEVEL=debug 등으로 변경 가능
const logLevel = process.env.LOG_LEVEL || 'info';

const logger = pino({
  // 로그 출력 레벨 설정
  // trace < debug < info < warn < error < fatal 순서
  level: logLevel,

  // Error 객체를 로그로 남길 때 message, stack 정보를 잘 출력하도록 설정
  serializers: {
    err: pino.stdSerializers.err
  },

  // 민감정보 마스킹 설정
  // API Key, Token, Authorization 값 등이 실수로 로그에 찍히는 것을 방지함
  redact: {
    paths: [
      'password',
      'token',
      'accessToken',
      'refreshToken',
      'apiKey',
      'serviceKey',
      'authorization',
      'headers.authorization',
      'headers.cookie'
    ],
    censor: '[REDACTED]'
  },

  transport: {
    targets: [
      {
        // 콘솔 출력용 설정
        // 개발 중 사람이 보기 좋은 형태로 로그를 출력함
        target: 'pino-pretty',
        options: {
          // 콘솔 로그 색상 적용
          colorize: true,

          // 시간 표시 형식 지정
          // SYS는 시스템 시간대를 사용하며, 위에서 Asia/Seoul로 설정했기 때문에 KST 기준 출력
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',

          // pid, hostname은 현재 크롤링/배치 로그에서는 중요도가 낮아 숨김 처리
          ignore: 'pid,hostname'
        }
      },
      {
        // 파일 저장용 설정
        // logs/pipeline.log 파일에 로그를 저장함
        target: 'pino/file',
        options: {
          // 로그 파일 저장 위치
          destination: logFilePath,

          // logs 폴더가 없으면 자동 생성
          mkdir: true
        }
      }
    ]
  }
});

module.exports = logger;