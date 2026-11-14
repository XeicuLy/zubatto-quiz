import * as z from 'zod';

/**
 * 管理者がホストを足し・外す HTTP API（/api/admin/hosts）の要求と応答の形（ADR 0013）。管理者のホストだけが使える。
 *
 * - GET    /api/admin/hosts                → 200 ListHostsResponse
 * - POST   /api/admin/hosts                AddHostRequest → 201 Host
 * - DELETE /api/admin/hosts/:githubUserId  → 204
 *
 * エラーは http/errors.ts の形で返す。管理者でないホストには 403 forbidden を返す
 */

/**
 * GitHub のログイン名。サーバーはこの形を確かめてから api.github.com に問い合わせる。
 * GitHub の決まりは「英数字とハイフン、39文字まで」。先頭のハイフンなどの細かい決まりは GitHub の 404 に任せ、
 * ここでは / . ? % のような、問い合わせの経路を書き換えうる文字を通さないことを確かめる
 */
export const githubLoginSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]{1,39}$/);

/** 許可リストの1行。GitHub の名前は変えられるので持たず、足したときの名前は note にメモとして入る */
export const hostSchema = z.object({
  /** GitHub のユーザー ID（数の文字列）。許可リストはこれで照らす */
  githubUserId: z.string(),
  /** 誰なのかのメモ。画面から足すと、足したときの GitHub の名前が入る */
  note: z.string().nullable(),
  /** 管理者の行は、画面からは外せない */
  isAdmin: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type Host = z.infer<typeof hostSchema>;

/** 足した順（古い順）に並べる */
export const listHostsResponseSchema = z.object({ hosts: z.array(hostSchema) });
export type ListHostsResponse = z.infer<typeof listHostsResponseSchema>;

export const addHostRequestSchema = z.object({ login: githubLoginSchema });
export type AddHostRequest = z.input<typeof addHostRequestSchema>;
