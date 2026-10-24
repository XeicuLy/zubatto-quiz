import type { Politeness } from '../src/components/a11y/announce';

/**
 * __root に常に置いてある読み上げ領域（Announcer）を返す。
 * role を付けていないので getByRole では探せない。見える箱の role="status" とぶつけないため
 */
export function liveRegion(politeness: Politeness): HTMLElement {
  const regions = document.querySelectorAll<HTMLElement>(`[aria-live="${politeness}"]`);
  if (regions.length !== 1) {
    throw new Error(`aria-live="${politeness}" の領域が ${regions.length} 個ある`);
  }
  return regions[0];
}
