# blacha/stac-spider

Spider STAC collections concurrently processing the results


## Usage

see ./src/operations


Dump all STAC documents from a collection.json and its children into a feature collection

```bash
npx tsx src/operations/feature.collection.ts s3://nz-imagery/wellington/wellington_2021_0.3m/rgb/2193/collection.json | pjl
```