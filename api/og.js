// Dynamic share image (1200×630) for link previews. The active filter is passed
// in as ?label= (computed by middleware.js) and drawn as a badge on a Knicks
// championship card. Built with plain element objects (Satori accepts them), so
// no JSX/build step is needed.
import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

const div = (style, children) => ({ type: "div", props: { style, children } });

export default function handler(req) {
  const { searchParams } = new URL(req.url);

  // Post-share card: the post's own image as the hero, with the originating
  // account + branding in a gradient bar along the bottom.
  const img = searchParams.get("img");
  if (img) {
    const acct = (searchParams.get("acct") || "").replace(/^@/, "").slice(0, 40);
    const plat = searchParams.get("plat") || "";
    const platLabel = plat === "x" ? "X" : plat === "instagram" ? "Instagram" : "";
    const overlay = [
      div({ display: "flex", fontSize: 30, color: "#cfe6ff", letterSpacing: 1, marginBottom: 8 }, "knicks.run · A Championship Picture Book"),
      div({ display: "flex", fontSize: 62, fontWeight: 800, color: "#ffffff" }, acct ? `@${acct}` : "A shared moment"),
    ];
    if (platLabel) overlay.push(div({ display: "flex", fontSize: 30, color: "#fc7b26", marginTop: 4 }, `from ${platLabel}`));
    const card = {
      type: "div",
      props: {
        style: { width: "100%", height: "100%", display: "flex", position: "relative", backgroundColor: "#0c65ab", fontFamily: "sans-serif" },
        children: [
          { type: "img", props: { src: img, style: { position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" } } },
          div({ position: "absolute", left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", padding: "40px 54px", backgroundImage: "linear-gradient(to top, rgba(0,107,182,0.98) 16%, rgba(0,107,182,0))" }, overlay),
        ],
      },
    };
    return new ImageResponse(card, { width: 1200, height: 630, headers: { "cache-control": "public, immutable, no-transform, max-age=86400" } });
  }

  const label = (searchParams.get("label") || "").slice(0, 90);

  const children = [
    div({ display: "flex", whiteSpace: "nowrap", fontSize: 34, letterSpacing: 2, color: "#cfe6ff", marginBottom: 16 }, "knicks.run"),
    div({ display: "flex", whiteSpace: "nowrap", fontSize: 56, fontWeight: 800, color: "#ffffff", lineHeight: 1.05 }, "Relive the run of the"),
    div({ display: "flex", whiteSpace: "nowrap", fontSize: 62, fontWeight: 800, color: "#fc7b26", lineHeight: 1.15, marginTop: 8 }, "2026 NBA Champions"),
  ];
  if (label) {
    children.push(
      div(
        { display: "flex", marginTop: 46, backgroundColor: "#fc7b26", color: "#ffffff", fontSize: 44, fontWeight: 700, padding: "16px 40px", border: "6px solid #ffffff" },
        label,
      ),
    );
  }

  const card = div(
    {
      width: "100%", height: "100%", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", backgroundColor: "#0c65ab",
      fontFamily: "sans-serif", padding: "50px", textAlign: "center",
    },
    children,
  );

  return new ImageResponse(card, {
    width: 1200,
    height: 630,
    headers: { "cache-control": "public, immutable, no-transform, max-age=86400" },
  });
}
