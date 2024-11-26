import { toFeatureMultiPolygon } from '@linzjs/geojson';
import { createWriteStream, writeFileSync, WriteStream } from 'fs';
import * as pc from 'polyclip-ts';
import { StacCollection, StacItem } from 'stac-ts';

import { main } from '../bin.js';
import { StacSpider } from '../spider.js';

const spider = new StacSpider();

let isFirst = true;

const files = new Map<string, WriteStream>();

spider.on('collection', async (item: StacCollection, url: URL): Promise<unknown> => {
  console.log(item.title, url.href);
  if (!url.href.startsWith('s3://nz-imagery/')) throw new Error('Unknown host');

  const imageryName = url.pathname.split('/').at(-4) as string;
  if (files.has(imageryName)) return false;

  const output = createWriteStream(`./features-${imageryName}.geojson`);
  output.write('{"type":"FeatureCollection","features":[\n');
  files.set(imageryName, output);
});

const polygons: unknown[] = [];

spider.on('item', async (item: StacItem, url: URL): Promise<void> => {
  const collection = await spider.getCollection(item, url);
  // GPQ doesnt like null datetimes
  if (item.properties.datetime == null) delete item.properties.datetime;
  const imageryName = url.pathname.split('/').at(-4) as string;
  console.log(url.href, imageryName);

  item.properties.title = collection.title;
  item.properties.description = collection.description;
  item.properties.license = collection.license;

  const output = files.get(imageryName);
  if (output == null) throw Error('Failed:' + url.href);

  if (!isFirst) output.write(',\n  ');
  isFirst = false;

  polygons.push(item.geometry?.coordinates);
  await new Promise<void>((r) => output.write(JSON.stringify(item), () => r()));
});

spider.on('end', async () => {
  console.log(pc.union(polygons));
  for (const [key, output] of files) {
    output.write('\n]}');
    await new Promise((r) => output.close(r));
    writeFileSync(`polygon-${key}.geojson`, JSON.stringify(toFeatureMultiPolygon(pc.union(polygons))));
  }
});

main(spider);
