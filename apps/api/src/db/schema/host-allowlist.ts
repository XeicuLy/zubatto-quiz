import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * ホストとしてログインしてよい GitHub のユーザー（ADR 0003）。登録とログインのたびに Better Auth の databaseHooks で確かめる。
 * 追加と削除は wrangler d1 execute で行い、画面は作らない（README の手順書）。
 */
export const hostAllowlist = sqliteTable('host_allowlist', {
  // GitHub のユーザー ID（数の文字列）。名前は変えられるので使わない。
  // Better Auth は同じ値を account.account_id に文字列で持つので、そろえて text にする
  githubUserId: text('github_user_id').primaryKey(),
  // 誰なのかのメモ。手で足すときに書く
  note: text('note'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});
