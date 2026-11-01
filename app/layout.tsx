import localFont from 'next/font/local';
import { siteMetadata } from '@/lib/seo';
import type { Metadata } from 'next';
import './globals.css';
import './workspace.css';
import './enhancements.css';
import './responsive.css';
import { PreferencesProvider } from '@/components/preferences';

const notoSans=localFont({src:'../node_modules/@fontsource-variable/noto-sans/files/noto-sans-latin-wght-normal.woff2',variable:'--font-noto-sans',weight:'100 900',display:'swap',adjustFontFallback:false,fallback:[]});
const notoThai=localFont({src:'../node_modules/@fontsource-variable/noto-sans-thai/files/noto-sans-thai-thai-wght-normal.woff2',variable:'--font-noto-thai',weight:'100 900',display:'swap',adjustFontFallback:false,fallback:[]});
export const metadata: Metadata = siteMetadata;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${notoSans.variable} ${notoThai.variable}`} suppressHydrationWarning><body><PreferencesProvider>{children}</PreferencesProvider></body></html>;
}
