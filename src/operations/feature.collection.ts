import { createWriteStream } from 'fs';
import { StacItem } from 'stac-ts';

import { main } from '../bin.js';
import { StacSpider } from '../spider.js';

const spider = new StacSpider();

let isFirst = true;

const output = createWriteStream('./features.geojson');
output.write('{"type":"FeatureCollection","features":[\n');

spider.on('item', async (item: StacItem, url: URL): Promise<void> => {
  const collection = await spider.getCollection(item, url);
  // GPQ doesnt like null datetimes
  if (item.properties.datetime == null) delete item.properties.datetime;

  item.properties.title = collection.title;
  item.properties.description = collection.description;
  item.properties.license = collection.license;

  if (!isFirst) output.write(',\n  ');
  isFirst = false;
  await new Promise<void>((r) => output.write(JSON.stringify(item), () => r()));
});

spider.on('end', async () => {
  output.write('\n]}');
  console.log('end');
  await new Promise((r) => output.close(r));
});

main(spider);
