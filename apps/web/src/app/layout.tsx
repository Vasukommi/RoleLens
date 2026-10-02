import type { Metadata } from "next";
import brandIcon from "../../assets/favicon.png";
import "./globals.css";

export const metadata: Metadata = {
  title: "RoleLens — Resume review with evidence",
  description:
    "A self-hosted workspace for reviewing resume evidence against explicit role requirements.",
  icons: {
    icon: {
      url: brandIcon.src,
      type: "image/png",
      sizes: `${brandIcon.width}x${brandIcon.height}`,
    },
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
