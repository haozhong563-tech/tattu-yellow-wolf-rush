import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TATTU黄狼极速无限消",
  description: "TATTU黑黄竞速科技风无尽三消游戏",
  icons: { icon: "/tattu-logo.png" },
};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>}
