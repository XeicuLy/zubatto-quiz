import type { BrowserContext } from '@playwright/test';

/**
 * そのコンテキストで開いたすべての画面から、CSP の違反を集める（ADR 0004）。
 * Chromium は、CSP に止めた読み込みや実行を、コンソールのエラー（「... violates the following Content Security Policy directive ...」）で知らせる。
 * 返した配列は、あとから開いた画面の分も増えていくので、テストの最後に空であることを確かめる
 */
export function collectCspViolations(context: BrowserContext): string[] {
  const violations: string[] = [];
  context.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Content Security Policy')) {
      violations.push(`${message.page()?.url() ?? '(画面なし)'}: ${message.text()}`);
    }
  });
  return violations;
}
