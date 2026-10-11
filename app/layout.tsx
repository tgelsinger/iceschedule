import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PSMHA Ice Check",
  description: "Checks whether the PSMHA Ice For Sale and 120+ min Ice Swap Board tables can be read.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
