/**
 * Generate a geojson footprint of a collection of tiffs using the highest level overview
 */
process.env['POLYGON_CLIPPING_MAX_QUEUE_SIZE'] = String(150_000_000);

import { Projection, Simplify } from '@basemaps/geo';
import { fsa } from '@chunkd/fs';
import { CogTiff } from '@cogeotiff/core';
import { MultiPolygon, union } from '@linzjs/geojson';
import buffer from '@turf/buffer';
import lineStringToPolygon from '@turf/line-to-polygon';
import simplify from '@turf/simplify';
import { writeFile } from 'fs/promises';
import pc from 'polygon-clipping';
import sharp from 'sharp';
import { StacItem } from 'stac-ts';

import { main } from '../bin.js';
import { logger } from '../log.js';
import { StacSpider } from '../spider.js';
import { ContourMipmap } from '../util/contors.mjs';

const spider = new StacSpider();

const OutputFeatures: GeoJSON.Feature<GeoJSON.Polygon, { name: string }>[] = [];

spider.on('item', async (item: StacItem, url: URL): Promise<void> => {
  const cog = item.assets['visual']; // TODO configurable?

  if (cog == null) return;
  console.time(cog.href);
  const cogHref = new URL(cog.href, url);

  const tiff = await CogTiff.create(fsa.source(cogHref));
  if (tiff == null) throw new Error('Failed to load: ' + cogHref.href);
  if (tiff.images[0] == null) throw new Error('Failed to load: ' + cogHref.href);

  logger.debug({ url: cogHref.href, images: tiff.images.length }, 'tiff:load');
  const origin = tiff.images[0].origin;
  //   const rootScale = tiff.images[0].resolution[0];
  const epsg = tiff.images[0].epsg;

  const bigImage = tiff.images[tiff.images.length - 1];
  if (bigImage == null) throw new Error('Failed to load: ' + cogHref.href);
  if (bigImage.tileCount.x !== 1 || bigImage.tileCount.y !== 1) throw new Error('Top image is more than 1x1');

  const scale = bigImage.resolution[0];

  const proj = Projection.get(epsg as number);
  const tile = await bigImage.getTile(0, 0);
  if (tile == null) {
    logger.error({ url: cog.href }, 'tiff:empty');
    return;
  }

  // Assumes this is somesort of image
  const raw = await sharp(tile.bytes).raw().toBuffer({ resolveWithObject: true });

  const mask = generateMaskBuffered(raw.data, raw.info);

  if (mask.alpha === 0) {
    //TODO just use the bounding box
    throw new Error('No Alpha Found');
  }

  const mipmap = new ContourMipmap(mask.data, raw.info.width + 2, raw.info.height + 2);
  const contours = mipmap.contour(1, { smoothCycles: 0 });

  // Convert pixel coords to real-world
  const coordinates: number[][][] = contours.map((coords: number[][]) =>
    coords.map(([x, y]) => {
      const source = [origin[0] + (x! - 1) * scale, origin[1] - (y! - 1) * scale];
      return proj.toWgs84(source);
    }),
  );

  const polygons = coordinates.map((co, id) => {
    // const before = co.length;
    // const points = Simplify.points(co as any, 0.000001);
    // console.log({ before, after: points.length });
    const poly = lineStringToPolygon({
      type: 'Feature',
      geometry: { type: 'MultiLineString', coordinates: [co] },
      properties: { name: cog.href, id },
    });
    return poly;
  }) as GeoJSON.Feature<GeoJSON.Polygon>[];

  if (polygons.length === 1) {
    OutputFeatures.push(polygons[0] as any);
    logger.debug({ url: cog.href }, 'tiff:done');
    // console.timeEnd(cog.href);
    return;
  }

  const xord = pc.xor(...polygons.map((m) => m.geometry.coordinates));

  // console.log(xord);
  const feat =
    //simplify(
    // buffer(
    {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: xord,
      },
      properties: { name: cog.href },
    };
  // 0.001,
  // ),
  //   { tolerance: 0.01, highQuality: false },
  // );

  // console.log(Simplify.multiPolygon(feat.geometry.coordinates, 0.001));
  // feat.geometry.coordinates = Simplify.multiPolygon(feat.geometry.coordinates, 0.001) as any;
  // console.log(ret);
  OutputFeatures.push(feat as any);

  // console.log(contours);
  console.timeEnd(cog.href);

  // throw new Error('No COG');
  //   console.log(tiff);
});

spider.on('end', async () => {
  logger.info('loading:done');
  await writeFile('./features.geojson', JSON.stringify({ type: 'FeatureCollection', features: OutputFeatures }));

  OutputFeatures.sort((a, b) => a.properties['name'].localeCompare(b.properties['name']));

  let u = [];
  const batchSize = 250;
  for (let i = 0; i < OutputFeatures.length; i += batchSize) {
    u = union(
      u,
      ...OutputFeatures.slice(i, i + batchSize).map((m) => {
        // console.log(JSON.stringify(m));
        return m.geometry.coordinates;
      }),
    );
    console.log(
      u.length,
      u.map((m) => m.length),
      // u.map((m) => m.properties.name),
      OutputFeatures[i]?.properties.name,
    );
  }
  // const unioned = union([], ...OutputFeatures.map((m) => m.geometry.coordinates));
  const buffered = buffer({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: u } }, 0.002);
  // const ret = Simplify.multiPolygon(buffered as any, 0.0001);
  // console.log(ret);

  console.log(buffered);
  await writeFile(
    './merged.geojson',
    JSON.stringify({
      type: 'Feature',
      geometry: buffered.geometry,
      properties: {},
    }),
  );

  await writeFile(
    './simple.geojson',
    JSON.stringify(
      simplify(
        {
          type: 'Feature',
          geometry: buffered.geometry,
          properties: {},
        },
        { tolerance: 0.0001 },
      ),
    ),
  );
});

function generateMaskBuffered(
  inp: Buffer,
  info: sharp.OutputInfo,
  buffer = 1,
): { data: Uint8Array; alpha: number; total: number } {
  if (info.channels !== 4) throw new Error('need alpha channel');
  performance.mark('mask:start');
  const width = info.width + buffer * 2;
  const height = info.height + buffer * 2;
  const output = new Uint8Array(width * height);
  let alphaCount = 0;
  let total = 0;

  for (let y = 0; y < info.height + buffer; y++) {
    for (let x = 0; x < info.width + buffer; x++) {
      const sourceX = x - buffer;
      const sourceY = y - buffer;
      if (sourceX < 0 || sourceY < 0) continue;
      if (sourceX >= info.width) continue;
      if (sourceY >= info.height) continue;

      // console.log(sourceX, sourceY,  * 4 + 3);

      const index = sourceY * info.width + sourceX;
      const offset = index * 4;
      // const r = inp[offset];
      // const g = inp[offset + 1];
      // const b = inp[offset + 2];
      const alpha = inp[offset + 3];

      if (alpha !== 0) {
        output[y * width + x] = 1;
        // points.push([x, y]);
        total++;
        continue;
      }
      alphaCount++;
    }
  }

  performance.mark('mask:end');
  return { data: output, alpha: alphaCount, total };
}

main(spider);
