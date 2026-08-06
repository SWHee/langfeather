import {useCallback, useMemo, useState, type ReactNode} from "react";

import {LanguageContext, type LanguageContextValue} from "./context";
import {
  localeOf,
  readLanguage,
  translate,
  writeLanguage,
  type Language,
} from "./i18n";

export function LanguageProvider({children}: {children: ReactNode}) {
  const [language, setLanguageState] = useState<Language>(readLanguage);

  const setLanguage = useCallback((next: Language) => {
    writeLanguage(next);
    setLanguageState(next);
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      locale: localeOf(language),
      setLanguage,
      t: (korean, params) => translate(language, korean, params),
    }),
    [language, setLanguage],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}
