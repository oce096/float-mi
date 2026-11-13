import { kvGet, kvSet, registerKvMigration } from "./kv-db";
// lib/css-scheme-storage.ts
// CSS 方案存储 — 保存/加载/删除用户的 CSS 方案

const STORAGE_KEY = "css-schemes-v1";
registerKvMigration(STORAGE_KEY);

export type CSSScheme = {
  id: string;
  name: string;
  css: string;
  target: string; // "global" | "chat_app" | "chat_session" | "story" | "music" | "calendar"
  createdAt: string;
};

function loadAll(): CSSScheme[] {
  try {
    return JSON.parse(kvGet(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveAll(schemes: CSSScheme[]) {
  kvSet(STORAGE_KEY, JSON.stringify(schemes));
}

/** Get all schemes for a given CSS target */
export function getSchemes(target: string): CSSScheme[] {
  return loadAll().filter(s => s.target === target);
}

/** Save current CSS as a named scheme */
export function saveScheme(target: string, name: string, css: string): CSSScheme {
  const all = loadAll();
  const scheme: CSSScheme = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    css,
    target,
    createdAt: new Date().toISOString(),
  };
  all.push(scheme);
  saveAll(all);
  return scheme;
}

/** Delete a scheme by id */
export function deleteScheme(id: string) {
  saveAll(loadAll().filter(s => s.id !== id));
}

/** Rename a scheme */
export function renameScheme(id: string, name: string) {
  const all = loadAll();
  const s = all.find(x => x.id === id);
  if (s && name.trim()) s.name = name.trim();
  saveAll(all);
}

/** Update scheme name and/or CSS content */
export function updateScheme(id: string, updates: { name?: string; css?: string }): CSSScheme | null {
  const all = loadAll();
  const s = all.find(x => x.id === id);
  if (!s) return null;
  if (typeof updates.name === "string" && updates.name.trim()) s.name = updates.name.trim();
  if (typeof updates.css === "string") s.css = updates.css;
  saveAll(all);
  return { ...s };
}

/** Upsert a scheme from Resource Hub or import: updates existing if same target & name, otherwise creates new */
export function saveOrUpdateSchemeByName(target: string, name: string, css: string): CSSScheme {
  const cleanName = name.trim() || "未命名预设";
  const all = loadAll();
  const existing = all.find(x => x.target === target && x.name === cleanName);
  if (existing) {
    existing.css = css;
    saveAll(all);
    return { ...existing };
  }
  return saveScheme(target, cleanName, css);
}
