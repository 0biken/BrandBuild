/**
 * Brand kit helpers: the fonts a brand can pick, and logo checks.
 * Fonts load from Google Fonts on demand, only when a screen shows them.
 */

export interface BrandFont {
  name: string;
  /** CSS font-family value. */
  stack: string;
  /** Google Fonts family spec, or undefined for fonts the app already has. */
  google?: string;
}

export const BRAND_FONTS: BrandFont[] = [
  { name: "Bricolage Grotesque", stack: "var(--font-bricolage), sans-serif" },
  { name: "Geist", stack: "var(--font-geist), sans-serif" },
  { name: "Poppins", stack: "'Poppins', sans-serif", google: "Poppins:wght@400;600;700" },
  { name: "Montserrat", stack: "'Montserrat', sans-serif", google: "Montserrat:wght@400;600;700" },
  { name: "DM Sans", stack: "'DM Sans', sans-serif", google: "DM+Sans:wght@400;600;700" },
  { name: "Space Grotesk", stack: "'Space Grotesk', sans-serif", google: "Space+Grotesk:wght@400;600;700" },
  { name: "Playfair Display", stack: "'Playfair Display', serif", google: "Playfair+Display:wght@400;600;700" },
  { name: "DM Serif Display", stack: "'DM Serif Display', serif", google: "DM+Serif+Display" },
  { name: "Lora", stack: "'Lora', serif", google: "Lora:wght@400;600;700" },
  { name: "Caveat", stack: "'Caveat', cursive", google: "Caveat:wght@400;700" },
];

export const DEFAULT_FONTS = { heading: "Bricolage Grotesque", body: "Geist" };
export const MAX_PALETTE = 3;

export function fontStack(name: string | undefined): string {
  return (BRAND_FONTS.find((f) => f.name === name) ?? BRAND_FONTS[0]).stack;
}

/** Adds the Google Fonts stylesheet for these fonts, once each. */
export function loadBrandFonts(names: (string | undefined)[]) {
  if (typeof document === "undefined") return;
  for (const name of names) {
    const font = BRAND_FONTS.find((f) => f.name === name);
    if (!font?.google) continue;
    const id = `brand-font-${font.google.split(":")[0]}`;
    if (document.getElementById(id)) continue;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`;
    document.head.appendChild(link);
  }
}

const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** Checks a logo file; returns a message for the user, or null. */
export function logoProblem(file: Pick<File, "type" | "size">): string | null {
  if (!LOGO_TYPES.includes(file.type)) return "Use a PNG, JPG, WebP or SVG file.";
  if (file.size > LOGO_MAX_BYTES) return "That logo is over 2 MB. Try a smaller file.";
  return null;
}

const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (v: string) => HEX.test(v);

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Turns a logo file into a small data URL. Photos are scaled down to 512px
 * so the brand stays light to store; SVGs are kept as they are.
 */
export async function logoToDataUrl(file: File, max = 512): Promise<string> {
  const url = await readAsDataUrl(file);
  if (file.type === "image/svg+xml") return url;
  try {
    // onload, not img.decode(): decode() can stall while the tab is hidden.
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      const timer = setTimeout(() => reject(new Error("timeout")), 5000);
      el.onload = () => {
        clearTimeout(timer);
        resolve(el);
      };
      el.onerror = () => {
        clearTimeout(timer);
        reject(new Error("unreadable"));
      };
      el.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    if (scale === 1 && file.size < 300 * 1024) return url;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    return url;
  }
}
