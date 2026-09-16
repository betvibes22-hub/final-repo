export const metadata = {
  title: "VideoGen",
  description: "Script-to-video generator",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
