import {useEffect, useState} from "react";

/**
 * Traces가 3분할로 설 수 있는 폭인지. 같은 값을 CSS도 알아야 하므로
 * styles.css의 `--split-min` media query와 이 상수를 함께 고친다.
 */
export const SPLIT_MIN_WIDTH = 1200;

const QUERY = `(min-width: ${SPLIT_MIN_WIDTH}px)`;

function matches(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(QUERY).matches
  );
}

/**
 * 3분할과 overlay는 동작이 다르다(자동 선택 여부). layout을 CSS에만 맡기면
 * 동작이 layout을 따라가지 못하므로 JS도 같은 경계를 본다.
 */
export function useSplitLayout(): boolean {
  const [split, setSplit] = useState(matches);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia(QUERY);
    const update = () => setSplit(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return split;
}
