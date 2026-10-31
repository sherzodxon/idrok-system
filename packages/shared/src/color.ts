// Brand colour helpers (isomorphic). The server derives missing shades and checks contrast when branding is saved.

const HEX = /^#[0-9a-fA-F]{6}$/;
export const isHexColor = (v: string) => HEX.test(v);

function toRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (rgb: number[]) => `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

/** Mixes `hex` with white (amount > 0) or black (amount < 0); amount in [-1, 1]. */
export function shade(hex: string, amount: number): string {
  const target = amount >= 0 ? 255 : 0;
  const a = Math.abs(amount);
  return toHex(toRgb(hex).map((c) => c + (target - c) * a));
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Hover/strong/soft shades derived from the primary colour when the school does not set them. */
export function deriveBrandShades(primary: string) {
  return {
    primaryHoverColor: shade(primary, -0.12),
    primaryStrongColor: shade(primary, -0.24),
    primarySoftColor: shade(primary, 0.88),
  };
}
