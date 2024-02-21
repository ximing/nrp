#!/usr/bin/env node
import yargs from 'yargs';
import { startServerFromConfigFile } from './main';
import { runServerInit } from './init';
import { log } from './logger';

void yargs(process.argv.slice(2))
  .scriptName('nrps')
  .usage('用法：$0 [命令]')
  .strict()
  .help('h')
  .alias('h', 'help')
  .command(
    '$0',
    '启动服务端',
    (cmd) =>
      cmd.option('c', {
        alias: 'config',
        describe: '配置文件路径',
        type: 'string',
        demandOption: true,
      }),
    (args) => {
      const { config } = args as unknown as { config: string };
      startServerFromConfigFile(config).catch((error) => {
        log.error(error as Error);
        process.exit(1);
      });
    },
  )
  .command(
    'init',
    '用终端界面生成配置文件',
    (cmd) =>
      cmd.option('o', {
        alias: 'output',
        describe: '配置文件路径',
        type: 'string',
        default: 'nrps.yaml',
      }),
    (args) => {
      if (!process.stdin.isTTY) {
        console.error('init 需要在终端里运行');
        process.exit(1);
      }
      const { output } = args as unknown as { output: string };
      runServerInit({
        outputPath: output,
        input: process.stdin,
        stdout: process.stdout,
        tty: true,
      }).then(
        (code) => process.exit(code),
        (error) => {
          log.error(error as Error);
          process.exit(1);
        },
      );
    },
  )
  .parse();
