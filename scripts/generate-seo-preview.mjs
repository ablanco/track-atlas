// Native composition of the attributed homepage photograph; no remote assets.
import sharp from "sharp";
const overlay = Buffer.from(
  `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="shade" x2="0" y2="1"><stop stop-color="#073B53" stop-opacity="0.05"/><stop offset="1" stop-color="#073B53" stop-opacity="0.95"/></linearGradient></defs><rect width="1200" height="630" fill="url(#shade)"/><rect x="70" y="439" width="80" height="8" rx="4" fill="#F36B2B"/><text x="66" y="541" fill="#F7F8F4" font-family="sans-serif" font-weight="700" font-size="88">Track Atlas</text></svg>`,
);
await sharp("public/images/pyrenees-1920.jpg")
  .resize(1200, 630, { fit: "cover" })
  .composite([{ input: overlay }])
  .jpeg({ quality: 90 })
  .toFile("public/images/track-atlas-preview.jpg");
