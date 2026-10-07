import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "TWC Assistant | Tebelopele Wellness Centre",
  description:
    "One chat for every need — bookings, services and approved health information. English or Setswana.",
  applicationName: "TWC Assistant",
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "any" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#09090b",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark h-full antialiased bg-zinc-950 ${poppins.variable}`}>
      <body
        className={`${poppins.className} min-h-full flex flex-col font-sans text-zinc-100 bg-[#09090b]`}
      >
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
