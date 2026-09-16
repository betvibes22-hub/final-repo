import "./globals.css";

export const metadata = {
  title: "Moh Personal Videos Production",
  description: "Script-to-video generator",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
