import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Music Dedup",
  description: "Organize your music library and clean up duplicates",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="border-b border-slate-800 px-6 py-4">
          <div className="mx-auto flex max-w-5xl items-center gap-6">
            <span className="font-semibold text-slate-100">🎵 Music Dedup</span>
            <Link href="/" className="text-sm text-slate-400 hover:text-slate-100">
              Dashboard
            </Link>
            <Link href="/duplicates" className="text-sm text-slate-400 hover:text-slate-100">
              Duplicates
            </Link>
          </div>
        </nav>
        <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
