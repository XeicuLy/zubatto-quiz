import { ROOM_MIGRATIONS } from './schema';

/**
 * 部屋の DO の SQLite に、まだ当てていない版のマイグレーションを当てる。DO のコンストラクタで呼ぶ。
 *
 * DO の SQLite では PRAGMA user_version が使えないので（2026-10-12 に Cloudflare のドキュメントで確認）、
 * 当てた版の番号を schema_migrations の表に持つ。
 */
export const migrate = (storage: DurableObjectStorage): void => {
  const { sql } = storage;
  sql.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');

  // 当てた版の最大。まだ何も当てていなければ 0
  const current = sql
    .exec<{ version: number }>('SELECT coalesce(max(version), 0) AS version FROM schema_migrations')
    .one().version;

  for (const [index, migration] of ROOM_MIGRATIONS.entries()) {
    const version = index + 1;
    // もう当てた版はとばす。休止から起きるたびにここを通るので、2回目以降は何もしない
    if (version <= current) continue;

    // 表を作ることと、作ったと記録することを1つのトランザクションにする。
    // 途中で失敗したら両方とも取り消され、次に起きたときにこの版から当て直せる
    storage.transactionSync(() => {
      sql.exec(migration);
      sql.exec('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', version, Date.now());
    });
  }
};
