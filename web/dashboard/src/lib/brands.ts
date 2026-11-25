import { catalog, type CatalogEntry } from "./catalog.ts";
import type { Connection } from "./types";

// The official marks a connection tile shows in place of its letter.
// Logos are Simple Icons 16.38.1 (CC0 1.0, https://simpleicons.org), copied
// as path data so the dashboard needs no icon package. Context7's comes from
// its own repository, Sigmie's from sigmie.com. Filesystem and Fetch have no brand, so they get a plain
// glyph drawn like the app's chevron.

export type Brand = { id: string; title: string; source: string } & (
  /** A filled logo in its brand color. */
  | { kind: "logo"; viewBox: string; path: string; hex: string }
  /** A 16px stroked glyph in the foreground color. */
  | { kind: "glyph"; path: string }
);

const simpleIcons = "Simple Icons 16.38.1, CC0 1.0";

export const brands: Brand[] = [
  {
    id: "github",
    title: "GitHub",
    source: simpleIcons,
    kind: "logo",
    viewBox: "0 0 24 24",
    hex: "#181717",
    path: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
  },
  {
    id: "sentry",
    title: "Sentry",
    source: simpleIcons,
    kind: "logo",
    viewBox: "0 0 24 24",
    hex: "#362D59",
    path: "M13.91 2.505c-.873-1.448-2.972-1.448-3.844 0L6.904 7.92a15.478 15.478 0 0 1 8.53 12.811h-2.221A13.301 13.301 0 0 0 5.784 9.814l-2.926 5.06a7.65 7.65 0 0 1 4.435 5.848H2.194a.365.365 0 0 1-.298-.534l1.413-2.402a5.16 5.16 0 0 0-1.614-.913L.296 19.275a2.182 2.182 0 0 0 .812 2.999 2.24 2.24 0 0 0 1.086.288h6.983a9.322 9.322 0 0 0-3.845-8.318l1.11-1.922a11.47 11.47 0 0 1 4.95 10.24h5.915a17.242 17.242 0 0 0-7.885-15.28l2.244-3.845a.37.37 0 0 1 .504-.13c.255.14 9.75 16.708 9.928 16.9a.365.365 0 0 1-.327.543h-2.287c.029.612.029 1.223 0 1.831h2.297a2.206 2.206 0 0 0 1.922-3.31z",
  },
  {
    id: "asana",
    title: "Asana",
    source: simpleIcons,
    kind: "logo",
    viewBox: "0 0 24 24",
    hex: "#F06A6A",
    path: "M18.78 12.653c-2.882 0-5.22 2.336-5.22 5.22s2.338 5.22 5.22 5.22 5.22-2.34 5.22-5.22-2.336-5.22-5.22-5.22zm-13.56 0c-2.88 0-5.22 2.337-5.22 5.22s2.338 5.22 5.22 5.22 5.22-2.338 5.22-5.22-2.336-5.22-5.22-5.22zm12-6.525c0 2.883-2.337 5.22-5.22 5.22-2.882 0-5.22-2.337-5.22-5.22 0-2.88 2.338-5.22 5.22-5.22 2.883 0 5.22 2.34 5.22 5.22z",
  },
  {
    id: "linear",
    title: "Linear",
    source: simpleIcons,
    kind: "logo",
    viewBox: "0 0 24 24",
    hex: "#5E6AD2",
    path: "M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z",
  },
  {
    id: "notion",
    title: "Notion",
    source: simpleIcons,
    kind: "logo",
    viewBox: "0 0 24 24",
    hex: "#000000",
    path: "M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z",
  },
  {
    id: "supabase",
    title: "Supabase",
    source: simpleIcons,
    kind: "logo",
    viewBox: "0 0 24 24",
    hex: "#3FCF8E",
    path: "M11.9 1.036c-.015-.986-1.26-1.41-1.874-.637L.764 12.05C-.33 13.427.65 15.455 2.409 15.455h9.579l.113 7.51c.014.985 1.259 1.408 1.873.636l9.262-11.653c1.093-1.375.113-3.403-1.645-3.403h-9.642z",
  },
  {
    id: "stripe",
    title: "Stripe",
    source: simpleIcons,
    kind: "logo",
    viewBox: "0 0 24 24",
    hex: "#635BFF",
    path: "M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z",
  },
  {
    id: "context7",
    title: "Context7",
    source: "github.com/upstash/context7 public/context7-icon.svg at f5fe541, MIT",
    kind: "logo",
    // The source draws the mark inside a 28px black square; the box crops to the mark.
    viewBox: "5 5 18 18",
    hex: "#000000",
    path: "M10.5724 15.2565C10.5724 17.5025 9.6613 19.3778 8.17805 21.1047H11.6319L11.6319 22.7786H6.33459V21.1895C7.95557 19.3566 8.58065 17.8628 8.58065 15.2565L10.5724 15.2565ZM17.4276 15.2565C17.4276 17.5025 18.3387 19.3778 19.822 21.1047H16.3681V22.7786H21.6654V21.1895C20.0444 19.3566 19.4194 17.8628 19.4194 15.2565H17.4276ZM10.5724 12.7435C10.5724 10.4975 9.66131 8.62224 8.17807 6.89532L11.6319 6.89532V5.22137L6.33461 5.22137V6.81056C7.95558 8.64343 8.58066 10.1373 8.58066 12.7435L10.5724 12.7435ZM17.4276 12.7435C17.4276 10.4975 18.3387 8.62224 19.822 6.89532L16.3681 6.89532L16.3681 5.22138L21.6654 5.22138V6.81056C20.0444 8.64343 19.4194 10.1373 19.4194 12.7435H17.4276Z",
  },
  {
    id: "sigmie",
    title: "Sigmie",
    source: "github.com/sigmie/sigmie.com public/logo/logo-icon-black.svg (Sigmie's own mark), its three paths merged",
    kind: "logo",
    viewBox: "0 0 50 50",
    hex: "#231F20",
    path: "M25 0C20.5 0 16.09 1.21 12.24 3.5C11.31 2.87 10.18 2.5 8.97 2.5C5.75 2.5 3.13 5.12 3.13 8.34C3.13 9.47 3.46 10.52 4.01 11.41C1.38 15.46 0 20.11 0 25C0 38.78 11.21 50 25 50C38.79 50 50 38.78 50 25C50 11.22 38.79 0 25 0ZM8.97 5.4C10.59 5.4 11.91 6.72 11.91 8.34C11.91 9.96 10.59 11.28 8.97 11.28C7.35 11.28 6.03 9.96 6.03 8.34C6.03 6.72 7.35 5.4 8.97 5.4ZM25 45.62C13.63 45.62 4.38 36.37 4.38 25C4.38 21.05 5.48 17.29 7.56 14.01C8.01 14.12 8.49 14.19 8.97 14.19C12.19 14.19 14.81 11.57 14.81 8.35C14.81 7.94 14.77 7.54 14.69 7.15C17.81 5.34 21.37 4.38 25 4.38C36.37 4.38 45.62 13.63 45.62 25C45.62 36.37 36.37 45.62 25 45.62Z M41.71 24.61C41.71 22.66 40.3 21.04 38.44 20.7C36.55 14.71 31 10.63 24.56 10.63C16.53 10.63 10 17.1 10 25.06C10 33.02 16.53 39.49 24.56 39.49C31.29 39.49 37.13 34.88 38.69 28.46C40.42 28.03 41.7 26.47 41.7 24.61H41.71ZM24.56 36.52C18.18 36.52 13 31.38 13 25.06C13 18.74 18.19 13.6 24.56 13.6C29.58 13.6 33.91 16.72 35.49 21.33C34.44 22.05 33.75 23.25 33.75 24.61C33.75 26.07 34.55 27.33 35.72 28.03C34.38 32.99 29.81 36.53 24.56 36.53V36.52ZM37.81 26.25C36.95 26.25 36.25 25.55 36.25 24.69C36.25 23.83 36.95 23.13 37.81 23.13C38.67 23.13 39.37 23.83 39.37 24.69C39.37 25.55 38.67 26.25 37.81 26.25Z M28.71 24.98C28.71 27.04 27.04 28.71 24.98 28.71C22.92 28.71 21.25 27.04 21.25 24.98C21.25 22.92 22.92 21.25 24.98 21.25C27.04 21.25 28.71 22.92 28.71 24.98Z",
  },
  {
    id: "google",
    title: "Google",
    source: simpleIcons,
    kind: "logo",
    viewBox: "0 0 24 24",
    hex: "#4285F4",
    path: "M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z",
  },
  {
    id: "telegram",
    title: "Telegram",
    source: simpleIcons,
    kind: "logo",
    viewBox: "0 0 24 24",
    hex: "#26A5E4",
    path: "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z",
  },
  {
    id: "whatsapp",
    title: "WhatsApp",
    source: simpleIcons,
    kind: "logo",
    viewBox: "0 0 24 24",
    hex: "#25D366",
    path: "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z",
  },
  {
    id: "filesystem",
    title: "Folder",
    source: "Drawn for Jungle",
    kind: "glyph",
    path: "M2.5 4.5a1 1 0 0 1 1-1h2.75l1.5 1.5h4.75a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z",
  },
  {
    id: "fetch",
    title: "Globe",
    source: "Drawn for Jungle",
    kind: "glyph",
    path: "M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 1 0 0-11zM2.5 8h11M8 2.5C6.5 4 5.75 6 5.75 8S6.5 12 8 13.5C9.5 12 10.25 10 10.25 8S9.5 4 8 2.5z",
  },
];

const byId = new Map(brands.map((brand) => [brand.id, brand]));

/**
 * The mark for a catalog entry or a registered connection, if it has one.
 * Tool sets have no brand; their tile stays a letter.
 */
export function brandFor(subject: CatalogEntry | Connection): Brand | undefined {
  if ("id" in subject) return byId.get(subject.id);
  const entry = catalog.find((candidate) => sameEndpoint(candidate, subject));
  // Heuristic: a custom install (a self-hosted asana, google or whatsapp server)
  // matches no catalog endpoint, so a name that is a brand id counts as that brand.
  return byId.get(entry?.id ?? subject.name.toLowerCase());
}

function sameEndpoint(entry: CatalogEntry, connection: Connection): boolean {
  const { kind, target, command } = connection.config_summary;
  if (!target) return false;
  if (entry.connect.kind === "remote") return kind !== "stdio" && host(entry.connect.url) === host(target);
  if (kind !== "stdio" || command !== entry.connect.command) return false;
  // The summary joins command and args with spaces, so the package is a whole word in it. Flags like -y may differ.
  const words = target.split(/\s+/);
  return entry.connect.args.filter((arg) => !arg.startsWith("-")).every((arg) => words.includes(arg));
}

function host(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/** The page canvas (`--bg` in styles.css) per theme. A tile is a light tint of its glyph over it. */
const canvas = { light: "#fcfcfc", dark: "#0a0a0a" };

/**
 * The glyph color per theme: the brand hex, or null for the foreground color.
 * The mark is decorative (the name sits beside it), so the bar is a shape that
 * stays visible, not text contrast: 1.8:1 against the canvas. That drops
 * near-black (GitHub, Notion, Context7: about 1.1) and Sentry's dark purple
 * (1.6) in dark mode, and keeps Supabase's and WhatsApp's greens (1.9) in light.
 */
export function markInk(brand: Brand): { light: string | null; dark: string | null } {
  if (brand.kind === "glyph") return { light: null, dark: null };
  const pick = (background: string) => (contrast(brand.hex, background) >= 1.8 ? brand.hex : null);
  return { light: pick(canvas.light), dark: pick(canvas.dark) };
}

/** WCAG 2 contrast ratio of two #rrggbb colors. */
function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
