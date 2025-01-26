import { createWriteStream, WriteStream } from 'fs';
import { StacCollection, StacItem } from 'stac-ts';

import { main } from '../bin.js';
import { StacSpider } from '../spider.js';

const spider = new StacSpider();

const isFirst = true;

const files = new Map<string, WriteStream>();

spider.on('collection', async (item: StacCollection, url: URL): Promise<unknown> => {
  console.log(item.title, url.href);
  console.log(item['linz:geospatial_category']);
  const imageryName = item['linz:slug'] + '__' + item['linz:geospatial_category'];
  if (files.has(imageryName)) return false;

  const output = createWriteStream(`./output-features/features-${imageryName}.geojson`);
  files.set(imageryName, output);
});

const polygons: unknown[] = [];

spider.on('item', async (item: StacItem, url: URL): Promise<void> => {
  const collection = await spider.getCollection(item, url);
  // GPQ doesnt like null datetimes
  if (item.properties.datetime == null) delete item.properties.datetime;
  const imageryName = url.pathname.split('/').at(-4) as string;
  // console.log(url.href, imageryName);

  item.properties.title = collection.title;
  item.properties.description = collection.description;
  item.properties.license = collection.license;

  const output = files.get(imageryName);
  if (output == null) throw Error('Failed:' + url.href);

  polygons.push(item.geometry?.coordinates);
  await new Promise<void>((r) => output.write(JSON.stringify(item) + '\n', () => r()));
});

spider.on('end', async () => {
  console.log('END');
  //  console.log(pc.union(polygons));
  for (const [_, output] of files) {
    await new Promise((r) => output.close(r));
    //writeFileSync(`./output-features/polygon-${key}.geojson`, JSON.stringify(toFeatureMultiPolygon(pc.union(polygons))));
  }
});

main(spider);
