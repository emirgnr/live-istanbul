import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import tr from './locales/tr.json'
import en from './locales/en.json'

const STORAGE_KEY = 'mli-ui'

/** Read the persisted language (zustand persist stores under STORAGE_KEY) without importing the store. */
function initialLang(): 'tr' | 'en' {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const lang = raw ? JSON.parse(raw)?.state?.lang : undefined
    if (lang === 'tr' || lang === 'en') return lang
  } catch {
    /* ignore */
  }
  return 'tr'
}

void i18n.use(initReactI18next).init({
  resources: {
    tr: { translation: tr },
    en: { translation: en },
  },
  lng: initialLang(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18n
