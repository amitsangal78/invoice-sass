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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
