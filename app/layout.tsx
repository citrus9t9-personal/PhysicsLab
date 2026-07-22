import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto");
  const protocol =
    forwardedProtocol ?? (host?.startsWith("localhost") ? "http" : "https");
  const origin = host ? protocol + "://" + host : "https://motionlab.example";

  return {
    title: "MotionLab — Interactive AP Physics Simulator",
    description:
      "Run guided AP Physics 1 experiments or build drag-and-drop systems with live motion, forces, graphs, and adjustable starting conditions.",
    openGraph: {
      title: "MotionLab — See the Forces Behind the Motion",
      description:
        "Explore guided experiments or build custom physics systems in a drag-and-drop sandbox.",
      type: "website",
      images: [
        {
          url: origin + "/og-motionlab.png",
          width: 1536,
          height: 1024,
          alt: "MotionLab physics poster showing projectile motion, an inclined plane, and a motion graph",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "MotionLab — See the Forces Behind the Motion",
      description:
        "Guided AP Physics 1 experiments and a drag-and-drop sandbox with live forces, values, and graphs.",
      images: [origin + "/og-motionlab.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
