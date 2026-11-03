import { queryOptions } from '@tanstack/react-query';

import { fetchHostSession } from './auth-client';

/**
 * ログインしているホスト。上の帯の名前に使う。
 * ログアウトでは queryClient.clear() で捨てる。GitHub から戻るときはページを読み直すので、覚えた値は残らない
 */
export const hostSessionQueryOptions = queryOptions({
  queryKey: ['host-session'],
  queryFn: fetchHostSession,
});
