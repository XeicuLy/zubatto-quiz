/** API が 2xx 以外を返した。401 はログインが切れた、404 はない（または他人の）セット */
export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`API が ${status} を返した`);
    this.name = 'ApiError';
  }
}
