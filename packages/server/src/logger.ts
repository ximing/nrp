import * as path from 'path';
import * as process from 'process';
import { logger } from '@nrpjs/shared';
import type pino from 'pino';

export const logGen: (msgPrefix?: string) => pino.Logger = logger(
  path.join(process.cwd(), 'nrps.log'),
);

export const log = logGen('[nrps] ');
