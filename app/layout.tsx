import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'd switch Sales AI', description: '株式会社tenの営業活動をひとつに。法人営業管理プロトタイプ', icons: { icon: [{ url: '/dswitch-icon.svg', type: 'image/svg+xml', sizes: 'any' }], apple: '/dswitch-logo.png' }, robots: { index: false, follow: false } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ja"><body>{children}</body></html>; }
