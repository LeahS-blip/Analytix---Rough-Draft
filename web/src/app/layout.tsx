import type { Metadata } from "next";
import "./dashboard.css";
import "./app.css";

export const metadata: Metadata = {
  title: "KeepStat",
  description: "Keep your analytics history forever.",
  icons: { icon: "/favicon.svg" },
};

// Applies the saved theme before first paint (no flash).
const themeScript = `try{var t=localStorage.getItem('ax-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Exo+2:ital,wght@0,600;0,700;0,800;1,800;1,900&family=Fragment+Mono&family=Host+Grotesk:wght@400;500;600;700;800&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
