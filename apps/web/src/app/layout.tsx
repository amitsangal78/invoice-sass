import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

// design-system.md specifies Inter for both platforms and tailwind.config.ts
// already lists it in the sans stack — it just was never actually loaded, so
// everything fell back to system-ui until now.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'Billify — Invoice. Get Paid. Grow.',
  description: 'Simple invoicing for freelancers, consultants, and small agencies.',
};

// Runs before first paint so a dark-mode user never sees a flash of the light
// theme. Can't be a React effect — those run after hydration, i.e. after the
// browser has already painted.
const THEME_INIT = `
try {
  var stored = localStorage.getItem('billify-theme');
  var dark = stored ? stored === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  if (dark) document.documentElement.classList.add('dark');
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
