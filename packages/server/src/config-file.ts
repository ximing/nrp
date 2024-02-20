import * as fs from 'fs';
import { parse, stringify } from 'yaml';
import { applyServerPatch } from '@nrpjs/shared';

export function readConfigFile(configPath: string): unknown {
  return parse(fs.readFileSync(configPath, 'utf8'));
}

export function writeConfigFile(configPath: string, config: unknown) {
  const temporary = `${configPath}.tmp`;
  fs.writeFileSync(temporary, stringify(config));
  fs.renameSync(temporary, configPath);
}

export function updateServerFile(configPath: string, patch: unknown) {
  const result = applyServerPatch(readConfigFile(configPath), patch);
  if (!result.ok) {
    return result;
  }
  writeConfigFile(configPath, result.config);
  return result;
}
