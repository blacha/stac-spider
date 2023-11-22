import './cn.fs.js';

import { StacCatalog, StacCollection, StacItem } from 'stac-ts';

import { Cache } from './cache.js';
import { logger } from './log.js';
import { ConcurrentQueue } from './queue.js';

export interface StacEvents {
  catalog: StacCatalog;
  item: StacItem;
  collection: StacCollection;
  end: undefined;
}

export class StacSpider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  events: { key: string; cb: (val: any, url: URL) => Promise<unknown> }[] = [];
  seen = new Set<string>();
  collections = new Map<string, Promise<StacCollection>>();
  q: ConcurrentQueue;
  maxQueueSize: number;

  constructor(concurrency: number = 25, maxQueueSize = 25_000) {
    this.q = new ConcurrentQueue(concurrency);
    this.maxQueueSize = maxQueueSize;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.q.onEmpty(() => this.emit('end', undefined, undefined as any));
  }

  on<T extends keyof StacEvents>(key: T, cb: (v: StacEvents[T], url: URL) => Promise<unknown>): void {
    this.events.push({ key, cb });
  }

  async emit<T extends keyof StacEvents>(key: T, value: StacEvents[T], url: URL): Promise<void> {
    for (const evt of this.events) {
      if (evt.key === key) await evt.cb(value, url);
    }
  }

  async processUrl(url: URL): Promise<unknown> {
    if (this.seen.has(url.href)) return;
    this.seen.add(url.href);
    await this.join();

    if (url.pathname.endsWith('collection.json')) return this.q.push(() => this.processCollection(url));
    if (url.pathname.endsWith('catalog.json')) return this.q.push(() => this.processCatalog(url));
    return this.q.push(() => this.processItem(url));
  }

  async processCollection(u: URL, recursive = true): Promise<StacCollection> {
    logger.debug({ url: u.href, q: this.q.todo.size }, 'fetch:collection');

    const collection = await Cache.readJson<StacCollection>(u);

    if (recursive) {
      for (const link of collection.links) {
        if (link.rel !== 'item') continue;
        this.processUrl(new URL(link.href, u));
      }
    }
    if (!this.collections.has(u.href)) this.collections.set(u.href, Promise.resolve(collection));
    logger.info({ url: u.href, title: collection.title, q: this.q.todo.size }, 'fetch:collection:done');

    await this.emit('collection', collection, u);

    await this.join();
    return collection;
  }

  async processCatalog(u: URL): Promise<StacCatalog> {
    logger.debug({ url: u.href }, 'fetch:catalog');

    const catalog = await Cache.readJson<StacCatalog>(u);

    for (const link of catalog.links) {
      if (link.rel !== 'child') continue;
      this.processUrl(new URL(link.href, u));
    }

    logger.info({ url: u.href, title: catalog.title, q: this.q.todo.size }, 'fetch:catalog:done');
    await this.emit('catalog', catalog, u);
    return catalog;
  }

  async getCollection(_item: StacItem | undefined, itemUrl: URL): Promise<StacCollection> {
    const collectionPath = new URL('collection.json', itemUrl);
    let collectionFetch = this.collections.get(collectionPath.href);
    if (collectionFetch == null) {
      collectionFetch = this.processCollection(collectionPath, false);
      this.collections.set(collectionPath.href, collectionFetch);
    }
    return await collectionFetch;
  }

  async processItem(u: URL): Promise<StacItem> {
    logger.trace({ url: u.href, q: this.q.todo.size }, 'fetch:item');

    // Ensure the collection is loaded first
    await this.getCollection(undefined, u);

    const item = await Cache.readJson<StacItem>(u);
    logger.trace({ url: u.href, item: item.id, q: this.q.todo.size }, 'fetch:item:done');

    await this.emit('item', item, u);
    return item;
  }

  async join(): Promise<void> {
    if (this.q.todo.size > this.maxQueueSize) await this.q.join();
  }
}
