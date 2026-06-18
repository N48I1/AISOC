import React, { createContext, useContext, useState, useEffect } from 'react';

// --- Dark Mode ---
const DarkModeContext = createContext<{ dark: boolean; toggle: () => void }>({ dark: false, toggle: () => {} });
const useDarkMode = () => useContext(DarkModeContext);

const DarkModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [dark, setDark] = useState<boolean>(() => {
    const stored = localStorage.getItem('soc_dark_mode');
    return stored ? stored === 'true' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('soc_dark_mode', String(dark));
  }, [dark]);

  const toggle = () => setDark(d => !d);
  return <DarkModeContext.Provider value={{ dark, toggle }}>{children}</DarkModeContext.Provider>;
};


export { DarkModeContext, useDarkMode, DarkModeProvider };
