import pino from 'pino';

// https://getpino.io/#/docs/transports?id=pino-pretty
// https://betterstack.com/community/guides/logging/how-to-install-setup-and-use-pino-to-log-node-js-applications/#prerequisites
export const logger = function (logPath: string) {
  return function (msgPrefix?: string): pino.Logger {
    const targets: any[] = [
      {
        target: 'pino-pretty',
        options: { colorize: true, destination: 1 }, // use 2 for stderr
        level: process.env.PINO_LOG_LEVEL || 'info',
      },
    ];
    if (logPath) {
      targets.push({
        target: 'pino/file',
        options: { destination: logPath },
        level: process.env.PINO_LOG_LEVEL || 'info',
      });
    }
    const transport = pino.transport({
      targets,
    });
    if (msgPrefix) {
      return pino(transport).child({}, { msgPrefix });
    }
    return pino(transport);
  };
};
