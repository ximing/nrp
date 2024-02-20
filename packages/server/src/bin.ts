#!/usr/bin/env node
import yargs from 'yargs';
import { startServerFromConfigFile } from './main';
import { log } from './logger';

function init() {
  const { argv } = yargs(process.argv.slice(2))
    .usage('Usage: $0 -c [config]')
    .option('c', {
      alias: 'config',
      describe: 'Path to YAML configuration file',
      type: 'string',
      demandOption: true,
    })
    .help('h')
    .alias('h', 'help');
  return argv as unknown as { config: string };
}

const argv = init();

startServerFromConfigFile(argv.config).catch((error) => {
  log.error(error as Error);
  process.exit(1);
});
