import './cn.fs.js';

import { createInterface } from 'node:readline/promises';

import { fsa } from '@chunkd/fs';
import { readFile } from 'fs/promises';

import { logger } from './log.js';
import { StacSpider } from './spider.js';

export async function main(spider: StacSpider): Promise<void> {
  try {
    for await (const line of createInterface({ input: process.stdin })) {
      await spider.processUrl(fsa.toUrl(line));
    }

    for (const arg of process.argv.slice(2)) {
      logger.debug({ arg }, 'arg:process');
      if (arg.startsWith('--')) continue;

      if (arg.endsWith('.txt')) {
        const files = (await readFile(arg, 'utf-8')).split('\n');
        for (const file of files) {
          if (file.trim() === '') continue;
          if (!file.endsWith('/collection.json')) {
            await spider.processUrl(fsa.toUrl(file + '/collection.json'));
          } else {
            await spider.processUrl(fsa.toUrl(file));
          }
        }
      }

      if (!arg.endsWith('.json')) throw new Error('Usage: node stac-spider :path_to_stac_json');
      spider.processUrl(fsa.toUrl(arg));
    }
    await spider.end();
    logger.info({ stats: spider.stats }, 'stac:done');
    console.log(spider.seen.size);
  } catch (e) {
    console.log(e);
    throw e;
  }
}
