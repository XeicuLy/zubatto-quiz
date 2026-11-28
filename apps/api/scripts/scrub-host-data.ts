/**
 * #345 より前のログインが残したホストの行を、ログインと同じ保存の規則（host-data-policy.ts）にそろえる SQL（ADR 0016 の W1）。
 *
 * - 手で1回流すためのもので、デプロイするルートからは使わない。package.json の host-data:check・host-data:scrub が
 *   scrub-host-data-cli.ts で SQL を出し、wrangler d1 execute に渡す（docs/runbooks/host-data.md）
 * - 確かめの SELECT と書き換えの UPDATE は、同じ「規則と違う」の条件から作る。数えた行と書き換える行がずれない
 * - どの UPDATE も、規則と違う行だけを書き換える。2回目は1行も書き換えず、結果が変わらない
 * - user.name は書き換えない。規則では GitHub の login だが、D1 に login が無く、SQL では作り直せない（手順書で1人ずつ直す）
 * - wrangler d1 execute には値を bind できないので、値は SQL の文字列に書く。書くのはこのファイルの定数と
 *   host-data-policy.ts の値だけで、D1 の中身や引数からは何も入れない
 *
 * node で直接動かす（scrub-host-data-cli.ts）ので、import は @/ ではなく相対パスに .ts を付けて書く。
 * schema/index.ts は拡張子の無い re-export なので、node では読めず、auth.ts を直接読む
 */
import { getTableColumns, getTableName, type Table } from 'drizzle-orm';

import {
  EMPTIED_ACCOUNT_FIELDS,
  EMPTIED_SESSION_FIELDS,
  hostUserFromGithub,
  syntheticEmail,
} from '../src/auth/host-data-policy.ts';
import { account, session, user } from '../src/db/schema/auth.ts';

type SqlValue = string | boolean | null | undefined;

/** SQL の値の書き方。undefined は D1 に NULL として入るので NULL、真偽は D1 の integer の 0・1 */
function literal(value: SqlValue) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${value.replaceAll("'", "''")}'`;
}

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

/**
 * drizzle の表から、SQL に書く表と列の名前を引く。列は drizzle のキー（accessToken）で引き、表の列の名前（access_token）にする。
 * 無いキーは規則の書き間違いなので止める。column は SET に書く名前、qualified は副問い合わせの中でも取り違えない名前
 */
function names(table: Table) {
  const columns = getTableColumns(table) as Record<string, { name: string } | undefined>;
  const tableName = quote(getTableName(table));
  const column = (key: string) => {
    const found = columns[key];
    if (!found) throw new Error(`${getTableName(table)} に ${key} の列が無い`);
    return quote(found.name);
  };
  return { table: tableName, column, qualified: (key: string) => `${tableName}.${column(key)}` };
}

const users = names(user);
const accounts = names(account);
const sessions = names(session);

/** ホストの GitHub の account の行の条件。provider_id は Better Auth の github の provider の ID */
const isGithubAccount = `${accounts.qualified('providerId')} = ${literal('github')}`;

/**
 * user の行の、規則どおりの email。GitHub の account_id に、syntheticEmail と同じ後ろの部分を付ける。
 * syntheticEmail('') は後ろの部分だけになる（中身が `<ID><後ろの部分>` の形なのは、テストで行ごとに照らしている）
 */
const expectedEmail = `((SELECT ${accounts.qualified('accountId')} FROM ${accounts.table} WHERE ${accounts.qualified('userId')} = ${users.qualified('id')} AND ${isGithubAccount}) || ${literal(syntheticEmail(''))})`;

/** hostUserFromGithub の値のうち、GitHub のプロフィールに頼らない列。name（login）と email（ID）は行ごとに違うので、ここでは使わない */
const { emailVerified, image } = hostUserFromGithub({ id: '', login: '' });

type Target = {
  /** 確かめの SELECT の列の名前 */
  label: string;
  names: ReturnType<typeof names>;
  /** drizzle の列のキーと、規則どおりの値の SQL */
  values: [key: string, sql: string][];
  /** 規則と違うかを見る前に、行を絞る条件 */
  scope?: string;
};

const fixed = (fields: Record<string, SqlValue>) =>
  Object.entries(fields).map(([key, value]): [string, string] => [key, literal(value)]);

const targets: Target[] = [
  {
    label: 'user_rows',
    names: users,
    values: [['email', expectedEmail], ...fixed({ emailVerified, image })],
    // GitHub の account が無い user は、合成の email が NULL になり、NOT NULL に当たって文ごと失敗する。ホストの行には必ずある
    scope: `${users.qualified('id')} IN (SELECT ${accounts.qualified('userId')} FROM ${accounts.table} WHERE ${isGithubAccount})`,
  },
  { label: 'account_rows', names: accounts, values: fixed(EMPTIED_ACCOUNT_FIELDS) },
  { label: 'session_rows', names: sessions, values: fixed(EMPTIED_SESSION_FIELDS) },
];

/** 規則と違う行の条件。NULL を比べるので、= と != ではなく IS と IS NOT を使う（NULL != 'x' は真にならない） */
function differs({ names, values, scope }: Target) {
  const anyDiffers = values.map(([key, value]) => `${names.qualified(key)} IS NOT ${value}`).join(' OR ');
  return scope ? `${scope} AND (${anyDiffers})` : anyDiffers;
}

/** 書き換える行の数を、表ごとに数える。書き換えの前と後に流し、後は全部 0 になる */
export const CHECK_SQL = `SELECT ${targets
  .map((target) => `(SELECT count(*) FROM ${target.names.table} WHERE ${differs(target)}) AS ${target.label}`)
  .join(', ')}`;

/** 書き換えの UPDATE。user → account → session の順。どの文も、ほかの文の結果に頼らない */
export const SCRUB_STATEMENTS = targets.map(
  (target) =>
    `UPDATE ${target.names.table} SET ${target.values
      .map(([key, value]) => `${target.names.column(key)} = ${value}`)
      .join(', ')} WHERE ${differs(target)}`,
);
