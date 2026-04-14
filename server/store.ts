import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SectionRow } from "./types";
import { ROOT_DIR } from "./paths";

const DATA_DIR = join(ROOT_DIR, "data");

export type LoadedIndex = {
  sections: SectionRow[];
  loadedAt: number;
  sourcePath: string;
};

export async function loadScheduleJson(path: string): Promise<SectionRow[]> {
  const raw = await readFile(path, "utf-8");
  const data = JSON.parse(raw) as SectionRow[];
  if (!Array.isArray(data)) throw new Error("schedule file must be a JSON array");
  return data;
}

export function defaultDataPath(term: string): string {
  return join(DATA_DIR, `${term}.json`);
}

export async function tryLoadTerm(term: string): Promise<LoadedIndex | null> {
  const p = defaultDataPath(term);
  if (!existsSync(p)) return null;
  const sections = await loadScheduleJson(p);
  const st = await import("node:fs/promises").then((fs) => fs.stat(p));
  return { sections, loadedAt: st.mtimeMs, sourcePath: p };
}
