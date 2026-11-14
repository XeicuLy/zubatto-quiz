import type { Politeness } from '@/components/a11y/announce';

/**
 * __root に常に置いてある読み上げ領域（Announcer）を返す。
 * role を付けていないので getByRole では探せない。見える箱の role="status" とぶつけないため。
 * toast の Viewport も aria-live="polite" を持つが、role="region" なので、role のないものだけを数える
 */
export function liveRegion(politeness: Politeness): HTMLElement {
  const regions = document.querySelectorAll<HTMLElement>(`[aria-live="${politeness}"]:not([role])`);
  if (regions.length !== 1) {
    throw new Error(`role のない aria-live="${politeness}" の領域が ${regions.length} 個ある`);
  }
  return regions[0];
}
