#!/usr/bin/env node
import yargs from 'yargs';
import * as fs from 'fs';
import { parse } from 'yaml';
import { NrpClient } from './main';
import { log } from './logger';

function init() {
  // 定义命令行参数
  const { argv } = yargs(process.argv.slice(2))
    .usage('Usage: $0 -c [config]')
    .option('c', {
      alias: 'config',
      describe: 'Path to YAML configuration file',
      type: 'string',
      demandOption: true, // 使配置文件参数变为必需
    })
    .help('h')
    .alias('h', 'help');
  return argv as any;
}

const argv = init();

// 读取并解析 YAML 配置文件
const readConfig = (configPath: string) => {
  try {
    const configFile = fs.readFileSync(configPath, 'utf8');
    return parse(configFile);
  } catch (error) {
    log.error(`Failed to read or parse the configuration file: ${error}`);
    process.exit(1);
  }
};

// 使用命令行参数中的配置文件路径
const config = readConfig(argv.config);
log.info(`config: ${JSON.stringify(config)}`);
const nrpClient = new NrpClient(config);
nrpClient.start();
