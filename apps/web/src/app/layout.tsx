import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RoleLens — Resume review with evidence",
  description:
    "A self-hosted workspace for reviewing resume evidence against explicit role requirements.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
