import "./globals.css";

export const metadata = {
  title: "YGL Mod",
  description: "Moderation tool for Young Global Leaders discussion groups",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900">{children}</body>
    </html>
  );
}
