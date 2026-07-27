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
});
