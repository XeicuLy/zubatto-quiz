import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/** 違反の1件。axe の結果は HTML や説明文まで持っていて、失敗したときの差分が読みにくいので、規則と場所だけにする */
interface A11yViolation {
  id: string;
  help: string;
  targets: string[];
}

/**
 * いま出ている画面を axe で調べ、WCAG 2 の A と AA の違反を返す。0件なら空の配列になる。
 * axe の検査のスクリプトは page.evaluate で差し込まれ、ページの CSP（script-src 'self'）には止められない。
 * それでも CSP を確かめる spec（csp.spec.ts・full-game.spec.ts）とは混ぜない
 */
export async function a11yViolations(page: Page): Promise<A11yViolation[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    // 色のコントラストは、選択肢の色とトークンを見直すまで外す（#126）。見直したら有効にする（#135）
    .disableRules(['color-contrast'])
    .analyze();
  return results.violations.map(({ id, help, nodes }) => ({
    id,
    help,
    targets: nodes.map((node) => node.target.join(' ')),
  }));
}
