import "./globals.css";

export const metadata = {
  title: "Nearspace",
  description:
    "Give it a structure, get back compounds Enamine or onepot can actually make — ranked, with ADMET properties.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
