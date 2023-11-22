import { S3Client } from '@aws-sdk/client-s3';
import { fsa } from '@chunkd/fs';
import { FsAwsS3 } from '@chunkd/fs-aws';
import type { HttpRequest } from '@smithy/types';

import { Cache } from './cache.js';

fsa.register('s3://', new FsAwsS3(new S3Client()));
// Public bucket :tada:
fsa.register(
  's3://nz-imagery',
  new FsAwsS3(new S3Client({ signer: { sign: async (request): Promise<HttpRequest> => request } })),
);

fsa.middleware.push(Cache);
