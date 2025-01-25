import { S3Client } from '@aws-sdk/client-s3';
import { fsa, FsHttp } from '@chunkd/fs';
import { FsAwsS3 } from '@chunkd/fs-aws';
import * as mw from '@chunkd/middleware';
import type { HttpRequest } from '@smithy/types';

import { Cache } from './cache.js';

fsa.register('s3://', new FsAwsS3(new S3Client()));
fsa.register('https://', new FsHttp());

// Public bucket :tada:
fsa.register(
  's3://nz-imagery',
  new FsAwsS3(new S3Client({ signer: { sign: async (request): Promise<HttpRequest> => request } })),
);

fsa.middleware.push(new mw.SourceChunk({ size: 64 * 1024 }));
// Cache the last 128MB in memory
// fsa.middleware.push(new mw.SourceCache({ size: 256 * 1024 * 1024 }));
// Cache the rest on disk
fsa.middleware.push(Cache);
