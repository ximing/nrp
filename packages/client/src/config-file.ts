import * as fs from 'fs';
import { parse, stringify } from 'yaml';
import { addClientProxy, applyClientPatch } from '@nrpjs/shared';

export function readConfigFile(configPath: string): unknown {
  return parse(fs.readFileSync(configPath, 'utf8'));
}

export function writeConfigFile(configPath: string, config: unknown) {
  const temporary = `${configPath}.tmp`;
  fs.writeFileSync(temporary, stringify(config));
  fs.renameSync(temporary, configPath);
}

export function updateClientFile(configPath: string, patch: unknown) {
  const result = applyClientPatch(readConfigFile(configPath), patch);
  if (!result.ok) {
    return result;
  }
  writeConfigFile(configPath, result.config);
  return result;
}

export function addClientProxyFile(configPath: string, entry: unknown) {
  const result = addClientProxy(readConfigFile(configPath), entry);
  if (!result.ok) {
    return result;
  }
  writeConfigFile(configPath, result.config);
  return result;
}
