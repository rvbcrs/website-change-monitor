import { useTranslation } from 'react-i18next';

export default function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const toggleLanguage = () => {
    const newLang = i18n.language === 'en' ? 'nl' : 'en';
    i18n.changeLanguage(newLang);
  };

  return (
    <button
      onClick={toggleLanguage}
      className="px-3 py-1 rounded-md bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs font-mono border border-gray-700 transition-colors uppercase"
      title="Switch Language"
    >
      {i18n.language}
    </button>
  );
}
