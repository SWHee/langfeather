import {createContext, useContext} from "react";

import {localeOf, translate, type Language} from "./i18n";

export type Translate = (
  korean: string,
  params?: Record<string, string | number>,
) => string;

export type LanguageContextValue = {
  language: Language;
  /** 날짜와 숫자 서식용. Intl에 그대로 넘긴다. */
  locale: string;
  setLanguage: (language: Language) => void;
  t: Translate;
};

/**
 * 기본값은 한국어다. Provider 밖에서 쓰여도 화면이 한국어로 동작해야 하므로
 * throw하지 않는다.
 */
export const LanguageContext = createContext<LanguageContextValue>({
  language: "ko",
  locale: localeOf("ko"),
  setLanguage: () => {},
  t: (korean, params) => translate("ko", korean, params),
});

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}

/** 문구만 필요한 대부분의 호출부용. */
export function useT(): Translate {
  return useContext(LanguageContext).t;
}

export function useLocale(): string {
  return useContext(LanguageContext).locale;
}
