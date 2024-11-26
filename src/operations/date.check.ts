import { fsa } from '@chunkd/fs';
import { StacCollection, StacItem } from 'stac-ts';

import { main } from '../bin.js';
import { StacSpider } from '../spider.js';

/**
 * Categorize all items and collections by the updated and created time stamps
 *
 * Generates a summary document with a mapping of date times to when a collection and items were created/updated
 *
 * ```json
 * {
 *   "updated": {
 *     "2024-09-17T21:16:23Z": {
 *       "items": 764,
 *       "collections": [
 *         "s3://linz-workflows-scratch/2024-11/22-test-update-stac-dates-gxql4/output/canterbury/canterbury_2020-2023/dem_1m/2193"
 *       ]
 *     },
 *     "2024-09-17T21:16:16Z": {
 *       "items": 764,
 *       "collections": [
 *         "s3://linz-workflows-scratch/2024-11/22-test-update-stac-dates-gxql4/output/canterbury/canterbury_2020-2023/dsm_1m/2193"
 *       ]
 *     },
 *     ...
 *   },
 *   "created": {
 *     ...
 *   }
 * }
 * ```
 *
 */
const spider = new StacSpider();

const knownHosts = new Set(['linz-workflows-scratch', 'nz-imagery', 'nz-elevation']);

const ByCreated = new Map();
const ByUpdated = new Map();

const collections = new Set();

spider.on('collection', async (_item: StacCollection, url: URL): Promise<unknown> => {
  collections.add(url.href);
  if (!knownHosts.has(url.hostname)) throw new Error('Unknown host');
  return true;
});

spider.on('item', async (item: StacItem, url: URL): Promise<void> => {
  const createdList = ByCreated.get(item.properties.created) ?? [];
  const updatedList = ByUpdated.get(item.properties.updated) ?? [];

  createdList.push(url.href);
  ByCreated.set(item.properties.created, createdList);

  if (item.properties.created === item.properties.updated) return;
  updatedList.push(url.href);
  ByUpdated.set(item.properties.updated, updatedList);
});

spider.on('end', async () => {
  const byUpdatedSummary: Record<string, unknown> = {};
  const byUpdatedObj: Record<string, string[]> = {};
  for (const u of ByUpdated.entries()) {
    const uniq = new Set(u[1].map((m: string) => m.slice(0, m.lastIndexOf('/'))));
    byUpdatedSummary[u[0]] = { items: u[1].length, collections: [...uniq] };
    byUpdatedObj[u[0]] = u[1];
  }

  const byCreatedSummary: Record<string, unknown> = {};
  const byCreatedObj: Record<string, string[]> = {};

  for (const u of ByCreated.entries()) {
    const uniq = new Set(u[1].map((m: string) => m.slice(0, m.lastIndexOf('/'))));
    byCreatedSummary[u[0]] = { items: u[1].length, collections: [...uniq] };
    byCreatedObj[u[0]] = u[1];
  }

  await fsa.write(fsa.toUrl('./output/updated.json'), JSON.stringify(byUpdatedObj, null, 2));
  await fsa.write(fsa.toUrl('./output/created.json'), JSON.stringify(byCreatedObj, null, 2));
  await fsa.write(
    fsa.toUrl('./output/summary.json'),
    JSON.stringify({ updated: byUpdatedSummary, created: byCreatedSummary }, null, 2),
  );
});

main(spider);
