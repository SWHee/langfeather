import "@testing-library/jest-dom/vitest";
import {cleanup} from "@testing-library/react";
import {afterEach} from "vitest";

class ResizeObserverMock implements ResizeObserver {
  readonly #callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }

  disconnect(): void {}

  observe(target: Element): void {
    const contentRect = {
      bottom: 600,
      height: 600,
      left: 0,
      right: 900,
      top: 0,
      width: 900,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
    const size = {blockSize: 600, inlineSize: 900};
    this.#callback(
      [
        {
          borderBoxSize: [size],
          contentBoxSize: [size],
          contentRect,
          devicePixelContentBoxSize: [size],
          target,
        },
      ],
      this,
    );
  }

  unobserve(): void {}
}

globalThis.ResizeObserver = ResizeObserverMock;

/**
 * jsdom에는 matchMedia가 없다. 기본값은 "일치하지 않음"이라 Traces는 overlay로
 * 동작한다. 3분할을 검사하는 test는 setViewportMatches로 켠다.
 */
let mediaMatches = false;
const mediaListeners = new Set<() => void>();

export function setViewportMatches(value: boolean): void {
  mediaMatches = value;
  mediaListeners.forEach((listener) => listener());
}

window.matchMedia = ((query: string) => ({
  media: query,
  get matches() {
    return mediaMatches;
  },
  onchange: null,
  addEventListener: (_: string, listener: () => void) => {
    mediaListeners.add(listener);
  },
  removeEventListener: (_: string, listener: () => void) => {
    mediaListeners.delete(listener);
  },
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

Object.defineProperties(HTMLElement.prototype, {
  offsetHeight: {
    configurable: true,
    get: () => 600,
  },
  offsetWidth: {
    configurable: true,
    get: () => 900,
  },
});

afterEach(() => {
  cleanup();
  setViewportMatches(false);
});
