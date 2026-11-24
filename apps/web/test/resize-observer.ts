import { vi } from 'vitest';

/**
 * jsdom は大きさを測らないので、ResizeObserver を差し替え、見ている要素の大きさの変化をテストから起こす。
 * 本物と同じく、変化は borderBoxSize で渡す
 */
export function stubResizeObserver() {
  const watched = new Map<Element, ResizeObserverCallback>();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      readonly #callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.#callback = callback;
      }
      observe(target: Element) {
        watched.set(target, this.#callback);
      }
      unobserve(target: Element) {
        watched.delete(target);
      }
      disconnect() {
        for (const [target, callback] of watched) {
          if (callback === this.#callback) {
            watched.delete(target);
          }
        }
      }
    },
  );
  return {
    watched: () => [...watched.keys()],
    resize(target: Element, blockSize: number) {
      const entry = { target, borderBoxSize: [{ blockSize, inlineSize: 0 }] } as unknown as ResizeObserverEntry;
      watched.get(target)?.([entry], {} as ResizeObserver);
    },
  };
}
