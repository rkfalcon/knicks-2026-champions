// Dynamic share image (1200×630) for link previews. The active filter is passed
// in as ?label= (computed by middleware.js) and drawn as a badge on a Knicks
// championship card. Built with plain element objects (Satori accepts them), so
// no JSX/build step is needed.
import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

const div = (style, children) => ({ type: "div", props: { style, children } });

export default function handler(req) {
  const { searchParams } = new URL(req.url);
  const label = (searchParams.get("label") || "").slice(0, 90);

  const card = div(
    {
      width: "100%", height: "100%", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", backgroundColor: "#0c65ab",
      fontFamily: "sans-serif", padding: "60px", textAlign: "center",
    },
    [
      div({ display: "flex", fontSize: 28, letterSpacing: 6, color: "#cfe6ff", marginBottom: 14, textTransform: "uppercase" }, "A Fan-Made Picture Book"),
      div({ display: "flex", fontSize: 92, fontWeight: 800, color: "#ffffff", lineHeight: 1 }, "NEW YORK KNICKS"),
      div({ display: "flex", fontSize: 70, fontWeight: 800, color: "#fc7b26", lineHeight: 1.15, marginTop: 6 }, "2026 NBA CHAMPIONS"),
      label
        ? div(
            { display: "flex", marginTop: 44, backgroundColor: "#fc7b26", color: "#ffffff", fontSize: 44, fontWeight: 700, padding: "16px 40px", border: "6px solid #ffffff" },
            label,
          )
        : div({ display: "flex", marginTop: 44, fontSize: 34, color: "#cfe6ff", letterSpacing: 2 }, "knicks.run"),
    ],
  );

  return new ImageResponse(card, {
    width: 1200,
    height: 630,
    headers: { "cache-control": "public, immutable, no-transform, max-age=86400" },
  });
}
