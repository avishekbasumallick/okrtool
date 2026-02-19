import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OKR Tool",
  description: "Create, prioritize, and manage OKRs with Gemini-powered suggestions."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
