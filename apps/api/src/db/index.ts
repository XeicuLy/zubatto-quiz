import { drizzle } from 'drizzle-orm/d1';

import * as schema from './schema';

/** D1 の binding から drizzle を作る。リクエストごとに作ってよい（接続を持たないので軽い） */
export const createDb = (d1: D1Database) => drizzle(d1, { schema });

export type Db = ReturnType<typeof createDb>;
