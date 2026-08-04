"""web token의 색 대비가 WCAG 기준을 만족하는지 검사한다.

`DESIGN.md`는 "text로 쓰는 색은 WCAG AA(4.5:1)를 만족한다"고 정하지만, 그 규칙을
지켰는지는 눈으로 알 수 없다. 이 script가 `web/src/styles.css`의 token을 실제로
읽어 대비를 계산한다. theme을 추가하거나 색을 바꿀 때 실행한다.

    uv run python scripts/check_contrast.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

STYLES = Path(__file__).resolve().parent.parent / "web" / "src" / "styles.css"

AA_TEXT = 4.5
AA_GRAPHIC = 3.0

# (전경 token, 배경 token, 최소 대비). 배경 위에 실제로 올라가는 조합만 적는다.
PAIRS: list[tuple[str, str, float]] = [
    ("ink", "surface", AA_TEXT),
    ("ink", "page", AA_TEXT),
    ("muted", "surface", AA_TEXT),
    ("muted", "page", AA_TEXT),
    ("muted", "surface-alt", AA_TEXT),
    ("quiet", "surface", AA_TEXT),
    ("quiet", "page", AA_TEXT),
    ("accent", "surface", AA_TEXT),
    ("accent", "page", AA_TEXT),
    ("accent", "accent-soft", AA_TEXT),
    ("on-accent", "accent", AA_TEXT),
    ("on-accent", "accent-hover", AA_TEXT),
    ("green", "surface", AA_TEXT),
    ("green", "green-soft", AA_TEXT),
    ("red", "surface", AA_TEXT),
    ("red-ink", "red-soft", AA_TEXT),
    ("orange", "surface", AA_TEXT),
    ("orange", "orange-soft", AA_TEXT),
    ("violet", "surface", AA_TEXT),
    ("violet", "violet-soft", AA_TEXT),
    ("blue", "surface", AA_TEXT),
    ("blue", "blue-soft", AA_TEXT),
    # chart series는 text가 아니라 graphic이라 3:1을 적용한다.
    ("series-1", "surface", AA_GRAPHIC),
    ("series-2", "surface", AA_GRAPHIC),
    ("series-3", "surface", AA_GRAPHIC),
    ("series-4", "surface", AA_GRAPHIC),
]

# mark는 logo 재현이 목적이라 대비 기준을 적용하지 않는다. text나 icon에 쓰지 않는다.
EXEMPT = {"accent-mark"}


THEMES = [("light", ":root {"), ("dark", ':root[data-theme="dark"] {')]


def read_tokens(css: str, selector: str) -> dict[str, str]:
    start = css.index(selector)
    block = css[start : css.index("}", start)]
    return {
        name: " ".join(value.split())
        for name, value in re.findall(r"(--[\w-]+):\s*([^;]+);", block)
    }


def resolve(name: str, tokens: dict[str, str]) -> str:
    value = tokens[name]
    for _ in range(10):
        match = re.search(r"var\((--[\w-]+)\)", value)
        if match is None:
            return value.strip()
        value = value[: match.start()] + tokens[match.group(1)] + value[match.end() :]
    raise ValueError(f"{name}의 var() 참조가 순환한다")


def luminance(hex_color: str) -> float:
    raw = hex_color.lstrip("#")
    channels = [int(raw[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    linear = [
        c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in channels
    ]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def ratio(foreground: str, background: str) -> float:
    lighter, darker = sorted(
        [luminance(foreground), luminance(background)], reverse=True
    )
    return (lighter + 0.05) / (darker + 0.05)


def main() -> int:
    css = STYLES.read_text(encoding="utf-8")
    light = read_tokens(css, ":root {")
    failures: list[str] = []
    checked = 0

    for theme, selector in THEMES:
        # dark는 semantic 층만 다시 정의하므로 light 위에 덮어쓴다.
        tokens = light if theme == "light" else {**light, **read_tokens(css, selector)}
        print(f"\n[{theme}]")
        for fg, bg, minimum in PAIRS:
            foreground = resolve(f"--{fg}", tokens)
            background = resolve(f"--{bg}", tokens)
            if not (foreground.startswith("#") and background.startswith("#")):
                failures.append(f"[{theme}] {fg} on {bg}: hex가 아니라 검사할 수 없다")
                continue
            value = ratio(foreground, background)
            status = "ok" if value >= minimum else "FAIL"
            print(f"  {fg:>10} on {bg:<12} {value:5.2f}:1  (>= {minimum}) {status}")
            checked += 1
            if value < minimum:
                failures.append(f"[{theme}] {fg} on {bg}: {value:.2f}:1 < {minimum}")

        unchecked = {
            name.lstrip("-")
            for name in tokens
            if not name.startswith("--c-")
            and re.fullmatch(r"#[0-9a-fA-F]{6}", resolve(name, tokens) or "")
        }
        unchecked -= {fg for fg, _, _ in PAIRS} | {bg for _, bg, _ in PAIRS} | EXEMPT
        if unchecked:
            print(f"  검사 대상에 없는 색 token: {', '.join(sorted(unchecked))}")
            print("  text로 쓰인다면 PAIRS에 추가한다.")

    if failures:
        print(f"\n{len(failures)}개 조합이 기준 미달이다:")
        for failure in failures:
            print(f"  - {failure}")
        return 1

    print(f"\n{checked}개 조합 전부 기준을 만족한다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
