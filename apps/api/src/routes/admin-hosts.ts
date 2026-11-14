import { addHostRequestSchema, type Host, type HttpError, type ListHostsResponse } from '@zubatto-quiz/protocol';
import { Hono } from 'hono';
import { csrf } from 'hono/csrf';

import { requireAdmin } from '@/auth/require-admin';
import { requireHost, type HostEnv } from '@/auth/require-host';
import { createDb } from '@/db';
import { lookupGithubUser } from '@/github/lookup-user';
import { addHost, listHosts, removeHost, type HostRow } from '@/hosts/repository';

import { jsonBody, notFound } from './common';

const toHost = ({ createdAt, ...row }: HostRow): Host => ({ ...row, createdAt: createdAt.toISOString() });

/**
 * 管理者がホストを足し・外す HTTP API（ADR 0013）。index.ts で /api/admin/hosts に置く。要求と応答の形は protocol の http/hosts.ts にある。
 *
 * csrf() はヘッダーだけで決まるので先に置き、requireHost（セッションと許可リスト）、requireAdmin（管理者の印）の順に通す。
 * 管理者の付け外しと、管理者のホストを外すことは、画面からはできない（runbook のコマンドだけ）。
 * GitHub の名前も ID もログに出さない
 */
export const adminHostRoutes = new Hono<HostEnv>()
  .use(csrf(), requireHost, requireAdmin)
  .get('/', async (c) => {
    const hosts = await listHosts(createDb(c.env.DB));
    return c.json({ hosts: hosts.map(toHost) } satisfies ListHostsResponse);
  })
  .post('/', jsonBody(addHostRequestSchema), async (c) => {
    const found = await lookupGithubUser(c.req.valid('json').login);
    if (found.kind === 'notFound') {
      return c.json(notFound, 404);
    }
    if (found.kind === 'unavailable') {
      return c.json({ error: 'github_unavailable' } satisfies HttpError, 502);
    }
    // 名前は変えられるので照らすのには使わず、足したときの名前をメモに残すだけにする
    const added = await addHost(createDb(c.env.DB), { githubUserId: found.githubUserId, note: found.login });
    if (!added) {
      return c.json({ error: 'already_exists' } satisfies HttpError, 409);
    }
    return c.json(toHost(added) satisfies Host, 201);
  })
  .delete('/:githubUserId', async (c) => {
    const result = await removeHost(createDb(c.env.DB), c.req.param('githubUserId'));
    if (result === 'notFound') {
      return c.json(notFound, 404);
    }
    if (result === 'admin') {
      return c.json({ error: 'admin_host' } satisfies HttpError, 409);
    }
    return c.body(null, 204);
  });
