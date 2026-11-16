import { queryOptions } from '@tanstack/react-query';
import { hostSchema, listHostsResponseSchema, type Host } from '@zubatto-quiz/protocol';

import { request, retryUnlessClientError } from './request';

/**
 * 管理者がホストを足し・外す HTTP API（/api/admin/hosts、ADR 0013）を呼ぶ。要求と応答の形は protocol の http/hosts.ts にある。
 * 管理者でないホストには、API が 403 forbidden を返す
 */

/** 許可リストを、足した順（古い順）に返す */
export async function fetchHosts(): Promise<Host[]> {
  const response = await request('GET', '/api/admin/hosts');
  return listHostsResponseSchema.parse(await response.json()).hosts;
}

export const hostsQueryOptions = queryOptions({
  queryKey: ['admin-hosts'],
  queryFn: fetchHosts,
  retry: retryUnlessClientError,
});

/**
 * GitHub のログイン名でホストを足し、足した行を返す。送る前に、画面で protocol の githubLoginSchema に通しておく。
 * GitHub にいなければ 404、もういれば 409 already_exists、GitHub が答えなければ 502 github_unavailable
 */
export async function addHost(login: string): Promise<Host> {
  const response = await request('POST', '/api/admin/hosts', { login });
  return hostSchema.parse(await response.json());
}

/** ホストを外す。その人のセッションも一緒に消える。管理者の行は 409 admin_host で断られる */
export async function removeHost(githubUserId: string): Promise<void> {
  await request('DELETE', `/api/admin/hosts/${encodeURIComponent(githubUserId)}`);
}
