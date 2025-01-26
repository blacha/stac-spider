import { fsa } from '@chunkd/fs';

import { FetchError } from '../cache.js';
import { logger } from '../log.js';
import { StacSpider } from '../spider.js';

const spider = new StacSpider();

const HostCount = new Map<string, number>();

function shuffle(array: Array<unknown>): void {
  let currentIndex = array.length;

  // While there remain elements to shuffle...
  while (currentIndex !== 0) {
    // Pick a remaining element...
    const randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
}

const MaxRandom = 100;
spider.on('catalog', async (cat, url) => {
  if (cat.id === FetchError) return false;

  shuffle(cat.links);
  for (const l of cat.links) {
    if (l.rel !== 'child') continue;
    const currentCount = HostCount.get(url.hostname) ?? 0;
    if (Math.random() * currentCount > MaxRandom) break;

    spider.processUrl(new URL(l.href, url));
    HostCount.set(url.hostname, currentCount + 1);
  }
  return false;
});

spider.on('collection', async (col, url) => {
  if (col.id === FetchError) return false;

  shuffle(col.links);

  for (const l of col.links) {
    if (l.rel !== 'item') continue;
    const currentCount = HostCount.get(url.hostname) ?? 0;
    if (Math.random() * currentCount > MaxRandom) break;

    spider.processUrl(new URL(l.href, url));
    HostCount.set(url.hostname, currentCount + 1);
  }
  return false;
});

spider.on('item', async () => {});

spider.on('empty', async () => {
  console.log(HostCount);
  logger.info('Done!');
  // process.exit();
});

const skip = new Set<string>([]);
interface StacIndexCatalogs {
  id: number;
  url: string;
  slug: string;
  title: string;
  access: 'public' | 'private';
  isApi: boolean;
  isPrivate: boolean;
}

async function main(): Promise<void> {
  const fullList: StacIndexCatalogs[] = await fsa.readJson(new URL('https://stacindex.org/api/catalogs'));
  const publicCatalogs = fullList.filter((f) => !f.isApi && !f.isPrivate);
  shuffle(publicCatalogs);

  for (const t of publicCatalogs) {
    const url = new URL(t.url);
    if (skip.has(url.hostname)) continue;
    spider.processUrl(url).then((f) => {
      if (f?.id === FetchError) {
        logger.fatal({ url: t.url, slug: t.slug }, 'failed');
      }
    });
  }
}

main();
