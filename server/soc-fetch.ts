const BASE = "https://act.ucsd.edu/scheduleOfClasses";

/** Minimal POST body matching the public "by subject" (tabs-sub / top tab) search. */
export function subjectSearchBody(term: string, subjectCode: string): string {
  const sub = subjectCode.endsWith(" ") ? subjectCode : `${subjectCode.trim()} `;
  const p = new URLSearchParams();
  p.set("selectedTerm", term);
  p.set("tabNum", "tabs-sub");
  p.set("selectedSubjects", sub);
  p.set("_selectedSubjects", "1");
  p.set("schedOption1", "true");
  p.set("_schedOption1", "on");
  p.set("schedOption2", "true");
  p.set("_schedOption2", "on");
  for (const d of ["M", "T", "W", "R", "F", "S"]) {
    p.append("schDay", d);
  }
  p.set("_schDay", "on");
  return p.toString();
}

export type FetchPageResult = { html: string; cookie: string };

function mergeCookies(prev: string, res: Response): string {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const parts = h.getSetCookie?.() ?? [];
  if (!parts.length) {
    const one = res.headers.get("set-cookie");
    if (one) parts.push(one);
  }
  if (!parts.length) return prev;
  const m = new Map<string, string>();
  for (const c of prev.split(";")) {
    const t = c.trim();
    if (!t) continue;
    const eq = t.indexOf("=");
    if (eq > 0) m.set(t.slice(0, eq), t.slice(eq + 1));
  }
  for (const line of parts) {
    const first = line.split(";")[0]!;
    const eq = first.indexOf("=");
    if (eq > 0) m.set(first.slice(0, eq), first.slice(eq + 1));
  }
  return [...m].map(([k, v]) => `${k}=${v}`).join("; ");
}

/** POST search; returns HTML and Cookie header for pagination GETs. */
export async function fetchSubjectPage(
  term: string,
  subjectCode: string,
  cookie: string | null
): Promise<FetchPageResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "text/html",
    "User-Agent": "EmptyBoard/0.1 (public schedule index)",
  };
  if (cookie) headers.Cookie = cookie;

  const res = await fetch(`${BASE}/scheduleOfClassesStudentResult.htm`, {
    method: "POST",
    headers,
    body: subjectSearchBody(term, subjectCode),
  });
  const html = await res.text();
  const next = mergeCookies(cookie ?? "", res);
  return { html, cookie: next };
}

export async function fetchSubjectPageN(term: string, page: number, cookie: string): Promise<string> {
  const u = new URL(`${BASE}/scheduleOfClassesStudentResult.htm`);
  u.searchParams.set("page", String(page));
  const res = await fetch(u, {
    headers: {
      Cookie: cookie,
      Accept: "text/html",
      "User-Agent": "EmptyBoard/0.1 (public schedule index)",
    },
  });
  return res.text();
}

export async function fetchSubjectListJson(term: string): Promise<{ code: string; value: string }[]> {
  const res = await fetch(`${BASE}/subject-list.json?selectedTerm=${encodeURIComponent(term)}`);
  if (!res.ok) throw new Error(`subject-list ${term}: ${res.status}`);
  return res.json();
}

export async function fetchTermsFromStudentPage(): Promise<{ code: string; label: string }[]> {
  const res = await fetch(`${BASE}/scheduleOfClassesStudent.htm`);
  const html = await res.text();
  const start = html.indexOf('id="selectedTerm"');
  const slice = start >= 0 ? html.slice(start, start + 80_000) : html;
  const out: { code: string; label: string }[] = [];
  const re = /<option[^>]*value="([^"]+)"[^>]*>\s*([^<]+?)\s*<\/option>/g;
  let x: RegExpExecArray | null;
  while ((x = re.exec(slice))) {
    const code = x[1];
    if (code === "default_collection" || code === "faculty-staff") continue;
    out.push({ code, label: x[2].replace(/\s+/g, " ").trim() });
  }
  return out;
}
