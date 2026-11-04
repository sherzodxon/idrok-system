// Options of the custom Select, read from ordinary <option> children (so every caller keeps writing <option>), and the
// search that long lists get.
import { Children, isValidElement, type ReactNode } from "react";

export interface SelectOption {
  value: string;
  label: string;
  disabled: boolean;
}

/** Lists longer than this get a search box. */
export const SEARCH_FROM = 8;

const textOf = (node: ReactNode): string => {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
};

/** <option> elements anywhere in `children` (fragments and arrays are flattened). */
export function optionsFromChildren(children: ReactNode): SelectOption[] {
  const out: SelectOption[] = [];
  const walk = (nodes: ReactNode) => {
    Children.forEach(nodes, (child) => {
      if (!isValidElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>(child)) return;
      if (child.type === "option") {
        const label = textOf(child.props.children);
        out.push({
          value: child.props.value === undefined ? label : String(child.props.value),
          label,
          disabled: !!child.props.disabled,
        });
      } else {
        walk(child.props.children);
      }
    });
  };
  walk(children);
  return out;
}

/**
 * Case, accents, the many Uzbek apostrophes (o' oʻ o’ o`) and punctuation do not matter: "ozbek" finds "O'zbek",
 * "7b" finds "7-B".
 */
export function normalizeSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/['`ʻʼ‘’ʹ]/g, "")
    .replace(/[-_.,·/\\()[\]]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function filterOptions(options: SelectOption[], query: string): SelectOption[] {
  const q = normalizeSearch(query);
  if (!q) return options;
  const words = q.split(" ");
  const compact = q.replace(/ /g, "");
  return options.filter((o) => {
    const label = normalizeSearch(o.label);
    return words.every((w) => label.includes(w)) || label.replace(/ /g, "").includes(compact);
  });
}
