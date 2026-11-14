import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * ホストとしてログインしてよい GitHub のユーザー（ADR 0003）。登録とログインのたびに Better Auth の databaseHooks で確かめる。
 * 管理者の印もここに持つので、管理者は必ずホストになる（ADR 0013）。
 * 管理者の付け外しは wrangler d1 execute だけで行い、画面からはできない（docs/runbooks/host-allowlist.md）。
 */
export const hostAllowlist = sqliteTable('host_allowlist', {
  // GitHub のユーザー ID（数の文字列）。名前は変えられるので使わない。
  // Better Auth は同じ値を account.account_id に文字列で持つので、そろえて text にする
  githubUserId: text('github_user_id').primaryKey(),
  // 誰なのかのメモ。手で足すときに書く
  note: text('note'),
  // 管理者の印。requireAdmin が要求のたびに読む（ADR 0013）。今ある行と、コマンドで足した行は管理者でない
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});
