/**
 * Generate a geojson footprint of a collection of tiffs using the highest level overview
 */
process.env['POLYGON_CLIPPING_MAX_QUEUE_SIZE'] = String(150_000_000);

import { writeFile } from 'node:fs/promises';

import { Projection } from '@basemaps/geo';
import { fsa } from '@chunkd/fs';
import { CogTiff } from '@cogeotiff/core';
import buffer from '@turf/buffer';
import lineStringToPolygon from '@turf/line-to-polygon';
import * as polyclip from 'polyclip-ts';
import sharp from 'sharp';
import { StacItem } from 'stac-ts';

import { main } from '../bin.js';
import { logger } from '../log.js';
import { StacSpider } from '../spider.js';
import { ContourMipmap } from '../util/contors.mjs';

const spider = new StacSpider();

type Feature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, { name: string }>;
const OutputFeatures: Feature[] = [];
const Unioned: any[] = [];

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
  const contours = mipmap.contour(1, { smoothCycles: 0 }) as [number, number][][];

  // Convert pixel coords to real-world
  // const coordinates: number[][][] = contours.map((coords: number[][]) =>
  //   coords.map(([x, y]) => {
  //     const source = [origin[0] + (x! - 1) * scale, origin[1] - (y! - 1) * scale];
  //     return proj.toWgs84(source);
  //   }),
  // );

  const polygons = contours.map((co, id) => {
    // const before = co.length;
    // const points = Simplify.points(co, 1);
    // console.log({ before, after: points.length });
    const poly = lineStringToPolygon({
      type: 'Feature',
      geometry: { type: 'MultiLineString', coordinates: [co] },
      properties: { name: cog.href, id },
    });
    return poly;
  }) as GeoJSON.Feature<GeoJSON.Polygon>[];

  const xord = polyclip.xor(...polygons.map((m) => m.geometry.coordinates)) as [number, number][][][];

  // console.log(polygons.map((m) => m.geometry.coordinates));

  if (polygons.length === 1) {
    const polyZero = polygons[0] as Feature;
    OutputFeatures.push(polyZero);
    polyZero.geometry.coordinates = polyZero.geometry.coordinates.map((ring) => {
      return ring.map((p: any) => {
        const pxToWorld = [origin[0] + (p[0]! - 1) * scale, origin[1] - (p[1]! - 1) * scale];
        return proj.toWgs84(pxToWorld);
      });
    }) as unknown as GeoJSON.Position[][][];

    logger.debug({ url: cog.href }, 'tiff:done');
    // Unioned = polyclip.union(Unioned, polyZero.geometry.coordinates);

    // console.timeEnd(cog.href);
    return;
  }

  // console.log(xord);

  // const projWgs84 = Projection.get();
  const coordinates = xord.map((poly) => {
    return poly.map((ring) =>
      ring.map((p) => {
        const pxToWorld = [origin[0] + (p[0] - 1) * scale, origin[1] - (p[1] - 1) * scale];
        return proj.toWgs84(pxToWorld);
      }),
    );
  }) as unknown as GeoJSON.Position[][][];

  const feat: Feature = {
    type: 'Feature',
    geometry: {
      type: 'MultiPolygon',
      coordinates,
    },
    properties: { name: cog.href },
  };

  OutputFeatures.push(feat);
  // Unioned = polyclip.union(Unioned, feat.geometry.coordinates);

  console.timeEnd(cog.href);
});

spider.on('end', async () => {
  logger.info('loading:done');
  await writeFile('./features.geojson', JSON.stringify({ type: 'FeatureCollection', features: OutputFeatures }));

  OutputFeatures.sort((a, b) => a.properties['name'].localeCompare(b.properties['name']));

  //   let u = [];
  //   const batchSize = 250;
  //   for (let i = 0; i < OutputFeatures.length; i += batchSize) {
  //     u = union(
  //       u,
  //       ...OutputFeatures.slice(i, i + batchSize).map((m) => {
  //         // console.log(JSON.stringify(m));
  //         return m.geometry.coordinates;
  //       }),
  //     );
  //     console.log(
  //       u.length,
  //       u.map((m) => m.length),
  //       // u.map((m) => m.properties.name),
  //       OutputFeatures[i]?.properties.name,
  //     );
  //   }
  const unioned = polyclip.union(...OutputFeatures.map((m) => m.geometry.coordinates));
  const buffered = buffer({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: unioned } }, 0.002);
  //   // const ret = Simplify.multiPolygon(buffered as any, 0.0001);
  //   // console.log(ret);

  //   console.log(buffered);
  await writeFile(
    './merged.geojson',
    JSON.stringify({
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: unioned },
      properties: {},
    }),
  );

  await writeFile(
    './simple.geojson',
    JSON.stringify({
      type: 'Feature',
      geometry: buffered.geometry,
      properties: {},
    }),
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
