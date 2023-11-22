import './cn.fs.js';

import { fsa } from '@chunkd/fs';

import { StacSpider } from './spider.js';

export async function main(spider: StacSpider): Promise<void> {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--')) continue;
    if (!arg.endsWith('.json')) throw new Error('Usage: node stac-spider :path_to_stac_json');
    spider.processUrl(fsa.toUrl(arg));
  }
}
