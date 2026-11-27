import type { ReactNode } from 'react';

export const metadata = { title: 'Roka Coins Data', robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
