import './cn.fs.js';

import { StacCatalog, StacCollection, StacItem } from 'stac-ts';

import { main } from './bin.js';
import { Cache } from './cache.js';
import { logger } from './log.js';
import { ConcurrentQueue } from './queue.js';

export interface StacEvents {
  catalog: [StacCatalog, URL];
  item: [StacItem, URL];
  collection: [StacCollection, URL];
  empty: [];
  end: [];
}

export class StacSpider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  events: { key: string; cb: (...args: any) => Promise<unknown> }[] = [];
  seen = new Set<string>();
  stats = { collections: 0, catalogs: 0, items: 0 };
  collections = new Map<string, Promise<StacCollection>>();
  q: ConcurrentQueue;
  maxQueueSize: number;

  constructor(concurrency: number = 25, maxQueueSize = 25_000) {
    this.q = new ConcurrentQueue(concurrency);
    this.maxQueueSize = maxQueueSize;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.q.onEmpty(() => this.emit('empty'));
  }

  async end(): Promise<void> {
    await this.emit('end');
  }

  on<T extends keyof StacEvents>(key: T, cb: (...args: StacEvents[T]) => Promise<unknown>): void {
    this.events.push({ key, cb });
  }

  async emit<T extends keyof StacEvents>(key: T, ...args: StacEvents[T]): Promise<boolean> {
    let ret = true;
    for (const evt of this.events) {
      if (evt.key === key) {
        if ((await evt.cb(...args)) === false) ret = false;
      }
    }
    return ret;
  }

  async processUrl(url: URL): Promise<{ id: string } | null> {
    if (this.seen.has(url.href)) return null;
    this.seen.add(url.href);
    await this.join();

    if (url.pathname.endsWith('collection.json')) return this.q.push(() => this.processCollection(url));
    if (url.pathname.endsWith('catalog.json')) return this.q.push(() => this.processCatalog(url));
    return this.q.push(() => this.processItem(url));
  }

  async processCollection(u: URL, recursive = true): Promise<StacCollection> {
    logger.debug({ url: u.href, q: this.q.todo.size }, 'fetch:collection');

    const collection = await Cache.readJson<StacCollection>(u);
    if (!this.collections.has(u.href)) {
      this.collections.set(u.href, Promise.resolve(collection));
      this.stats.collections++;
    }

    logger.info({ url: u.href, title: collection.title, q: this.q.todo.size }, 'fetch:collection:done');

    const isAbort = await this.emit('collection', collection, u);
    if (isAbort === false) {
      await this.join();
      return collection;
    }

    if (recursive) {
      for (const link of collection.links) {
        if (link.rel !== 'item') continue;
        this.processUrl(new URL(link.href, u));
      }
    }

    await this.join();
    return collection;
  }

  async processCatalog(u: URL): Promise<StacCatalog> {
    logger.debug({ url: u.href }, 'fetch:catalog');
    this.stats.catalogs++;

    const catalog = await Cache.readJson<StacCatalog>(u);
    logger.info({ url: u.href, title: catalog.title, q: this.q.todo.size }, 'fetch:catalog:done');
    const isAbort = await this.emit('catalog', catalog, u);
    if (isAbort === false) {
      await this.join();
      return catalog;
    }

    for (const link of catalog.links) {
      if (link.rel !== 'child') continue;
      this.processUrl(new URL(link.href, u));
    }

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
    this.stats.items++;

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

  async start(): Promise<void> {
    await main(this);
  }
}
