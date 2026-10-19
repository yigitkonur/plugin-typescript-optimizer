import type { ReactNode } from "react";
import { Header } from "@/components/Header";

export const metadata = { title: "F05 Next app" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Header />
        {children}
      </body>
    </html>
  );
}
