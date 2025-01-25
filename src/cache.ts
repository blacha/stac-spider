import { fsa } from '@chunkd/fs';
import { SourceCallback, SourceRequest } from '@chunkd/source';
import { mkdir, readFile, writeFile } from 'fs/promises';

import { logger } from './log.js';

export const FetchError = 'StacSpider__FetchError__';

export const Cache = {
  name: 'cache',
  isFirstRequest: true,
  // Cache all requests to load JSON
  async readJson<T>(loc: URL): Promise<T> {
    const cacheKey = './cache/' + loc.protocol.replace(':', '') + '/' + loc.hostname + '/' + loc.pathname.slice(1);
    try {
      const read = JSON.parse(await readFile(cacheKey, 'utf-8'));
      logger.trace({ cacheKey, loc: loc.href }, 'cache:hit');
      return read;
    } catch (e) {
      if (Cache.isFirstRequest) await mkdir('./cache', { recursive: true });
      Cache.isFirstRequest = false;

      logger.trace({ url: loc.href }, 'cache:miss');
      let err: Error | null = null;
      const ret = await fsa.read(loc).catch((e) => {
        logger.error({ u: loc.href, err: String(e) }, 'fetch:failed');
        err = e;
      });
      if (ret == null) {
        await fsa.write(
          fsa.toUrl(cacheKey),
          JSON.stringify(
            { id: FetchError, error: String(err), $source: loc.href, $fetchedAt: new Date().toISOString() } as T,
            null,
            2,
          ),
        );

        return { id: FetchError } as T;
      }
      try {
        const data = Buffer.from(ret);
        const item = JSON.parse(data.toString()) as T & { $source: string };
        item.$source = loc.href;
        await fsa.write(fsa.toUrl(cacheKey), JSON.stringify(item, null, 2));
        return item;
      } catch (e) {
        logger.error({ u: loc.href, err: String(e) }, 'fetch:failed');
        return { id: FetchError } as T;
      }
    }
  },

  // Cache all partial reads
  async fetch(req: SourceRequest, next: SourceCallback): Promise<ArrayBuffer> {
    const reqId =
      `./cache/` +
      req.source.url.protocol.replace(':', '') +
      '.' +
      req.source.url.hostname +
      '.' +
      req.source.url.pathname.slice(1).replaceAll('/', '__') +
      '_at_' +
      req.offset +
      '+' +
      req.length +
      '.bin';

    try {
      const buf = await readFile(reqId);

      return buf.buffer;
    } catch (e) {
      if (Cache.isFirstRequest) await mkdir('./cache', { recursive: true });
      Cache.isFirstRequest = false;
      logger.debug({ url: req.source.url, offset: req.offset, length: req.length }, 'cache:miss');

      // log
      const data = await next(req);

      await writeFile(reqId, Buffer.from(data));
      return data;
    }
  },
};
