'use client';
import { useLocale } from './preferences';

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useLocale();
  function select(value: 'th' | 'en') {
    setLanguage(value);
    // Guests keep their choice locally; signed-in users also save it to their account.
    void fetch('/api/preferences', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: value }) }).catch(() => {});
  }
  return <div className="language-switcher" role="group" aria-label={t('Language')}>
    {(['th','en'] as const).map(value => <button type="button" key={value} lang={value} aria-label={value === 'th' ? 'ภาษาไทย (TH)' : 'English (EN)'} aria-pressed={language === value} onClick={() => select(value)}>{value.toUpperCase()}</button>)}
  </div>;
}
