import { fsa } from '@chunkd/fs';
import { CogTiff } from '@cogeotiff/core';
import { StacItem } from 'stac-ts';

import { main } from '../bin.js';
import { StacSpider } from '../spider.js';

const spider = new StacSpider();

spider.on('item', async (item: StacItem, url: URL): Promise<void> => {
  const cog = item.assets['visual'];
  if (cog == null) return;

  const cogHref = new URL(cog.href, url);

  const tiff = await spider.q.push(() => CogTiff.create(fsa.source(cogHref)));

  console.log(tiff);
});

main(spider);
