import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { RawIntlProvider } from "react-intl";
import { changeLocale, getLocale, intl } from "src/locale";

// Context
export interface LocaleContextType {
	setLocale: (locale: string) => void;
	locale: string;
}

const initalValue = null;
const LocaleContext = createContext<LocaleContextType | null>(initalValue);

// Provider
interface Props {
	children?: ReactNode;
}
function LocaleProvider({ children }: Props) {
	const [locale, setLocaleValue] = useState(() => getLocale());

	useEffect(() => {
		document.documentElement.lang = locale;
	}, [locale]);

	const setLocale = (next: string) => {
		if (next === locale) return;
		changeLocale(next);
		setLocaleValue(next);
	};

	const value = { locale, setLocale };

	// NginxionS: update the message context while keeping the existing forms, dialogs and authentication state.
	return (
		<LocaleContext.Provider value={value}>
			<RawIntlProvider value={intl}>{children}</RawIntlProvider>
		</LocaleContext.Provider>
	);
}

function useLocaleState() {
	const context = useContext(LocaleContext);
	if (!context) {
		throw new Error("useLocaleState must be used within a LocaleProvider");
	}
	return context;
}

export { LocaleProvider, useLocaleState };
export default LocaleContext;
