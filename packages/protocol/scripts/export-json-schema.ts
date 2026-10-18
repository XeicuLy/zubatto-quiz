import { writeFileSync } from 'node:fs';

import { buildWsJsonSchema } from '../src/json-schema.ts';
import { buildOpenApiDocument } from '../src/openapi.ts';

// pnpm --filter @zubatto-quiz/protocol run schema で書き出す。そのあと oxfmt で整形する。
// 書き出し忘れは、src/json-schema.test.ts と src/openapi.test.ts が CI で見つける
const write = (file: string, document: unknown) =>
  writeFileSync(new URL(`../schema/${file}`, import.meta.url), `${JSON.stringify(document, null, 2)}\n`);

write('ws.schema.json', buildWsJsonSchema());
write('openapi.json', buildOpenApiDocument());
