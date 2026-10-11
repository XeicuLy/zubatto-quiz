import { writeFileSync } from 'node:fs';

import { buildWsJsonSchema } from '../src/json-schema.ts';

// pnpm --filter @zubatto-quiz/protocol run schema で書き出す。そのあと oxfmt で整形する。
// 書き出し忘れは、src/json-schema.test.ts が CI で見つける
writeFileSync(
  new URL('../schema/ws.schema.json', import.meta.url),
  `${JSON.stringify(buildWsJsonSchema(), null, 2)}\n`,
);
