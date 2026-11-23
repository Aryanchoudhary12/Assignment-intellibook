import "./styles.css";

export const metadata = {
  title: "Clausebook — Contract review",
  description: "Review contracts against a fixed checklist and ask questions grounded in the source.",
};
export const viewport = {themeColor: "#111c2e"};

export default function RootLayout({children}) {
  return <html lang="en"><body>{children}</body></html>;
}
