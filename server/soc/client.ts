export const SOC_BASE_URL = "https://act.ucsd.edu/scheduleOfClasses";
const DEFAULT_USER_AGENT = "EmptyBoard/0.1 (public schedule index)";
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export type FetchPageResult = {
  html: string;
  cookie: string;
};

export type SubjectListItem = {
  code: string;
  value: string;
};

export type SocClientOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  userAgent?: string;
};

export class UpstreamSocError extends Error {
  readonly status?: number;
  readonly url: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    opts: { url: string; status?: number; retryable?: boolean; cause?: unknown }
  ) {
    super(message, { cause: opts.cause });
    this.name = "UpstreamSocError";
    this.url = opts.url;
    this.status = opts.status;
    this.retryable =
      opts.retryable ?? (opts.status === undefined || RETRYABLE_STATUSES.has(opts.status));
  }
}

export interface SocClient {
  fetchTermsPage(): Promise<string>;
  fetchSubjectListJson(term: string): Promise<SubjectListItem[]>;
  fetchSubjectFirstPage(term: string, subjectCode: string, cookie?: string | null): Promise<FetchPageResult>;
  fetchSubjectResultPage(page: number, cookie: string): Promise<string>;
}

/**
 * Course-level checkboxes covering the full UCSD Schedule of Classes catalog:
 * 1-99 (1), 87&90s (11), 99s (12), 100-198 (2), 195s (4), 199s (5),
 * 200-297 (3), 298s (7), 299s (8), 300+ (13), 400+ (10), 500+ (9).
 */
const ALL_SCHED_OPTIONS = [
  "schedOption1",
  "schedOption11",
  "schedOption12",
  "schedOption2",
  "schedOption4",
  "schedOption5",
  "schedOption3",
  "schedOption7",
  "schedOption8",
  "schedOption13",
  "schedOption10",
  "schedOption9",
] as const;

/** Minimal POST body matching the public "by subject" (tabs-sub) search form. */
export function subjectSearchBody(term: string, subjectCode: string): string {
  const params = new URLSearchParams();
  params.set("selectedTerm", term);
  params.set("tabNum", "tabs-sub");
  params.set("selectedSubjects", `${subjectCode.trim()} `);
  params.set("_selectedSubjects", "1");
  for (const opt of ALL_SCHED_OPTIONS) {
    params.set(opt, "true");
    params.set(`_${opt}`, "on");
  }
  for (const d of ["M", "T", "W", "R", "F", "S"]) {
    params.append("schDay", d);
  }
  params.set("_schDay", "on");
  return params.toString();
}

export function mergeCookies(prev: string, res: Response): string {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const parts = headers.getSetCookie?.() ?? [];
  if (!parts.length) {
    const single = res.headers.get("set-cookie");
    if (single) parts.push(single);
  }
  if (!parts.length) return prev;

  const jar = new Map<string, string>();
  for (const pair of prev.split(";")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) jar.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  for (const line of parts) {
    const first = line.split(";")[0] ?? "";
    const eq = first.indexOf("=");
    if (eq > 0) jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createSocClient(opts: SocClientOptions = {}): SocClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const maxRetries = Math.max(0, opts.maxRetries ?? 2);
  const retryBaseDelayMs = Math.max(0, opts.retryBaseDelayMs ?? 250);
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;

  async function requestWithRetry<T>(
    url: string,
    init: RequestInit,
    readBody: (res: Response) => Promise<T>
  ): Promise<T> {
    let lastError: UpstreamSocError | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetchImpl(url, {
          ...init,
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!res.ok) {
          await res.body?.cancel().catch(() => undefined);
          throw new UpstreamSocError(`UCSD SOC request failed (${res.status})`, {
            url,
            status: res.status,
            retryable: RETRYABLE_STATUSES.has(res.status),
          });
        }

        return await readBody(res);
      } catch (err) {
        if (err instanceof UpstreamSocError) {
          lastError = err;
        } else {
          // SyntaxError from malformed JSON is non-retryable; network/timeout/stream errors are retryable.
          const retryable = !(err instanceof SyntaxError);
          lastError = new UpstreamSocError(
            `UCSD SOC request error: ${err instanceof Error ? err.message : String(err)}`,
            { url, retryable, cause: err }
          );
        }

        if (attempt < maxRetries && lastError.retryable) {
          const delayMs = retryBaseDelayMs * 2 ** attempt;
          if (delayMs > 0) await sleep(delayMs);
          continue;
        }
        throw lastError;
      }
    }

    throw lastError!;
  }

  return {
    fetchTermsPage(): Promise<string> {
      const url = `${SOC_BASE_URL}/scheduleOfClassesStudent.htm`;
      return requestWithRetry(
        url,
        {
          method: "GET",
          headers: {
            Accept: "text/html",
            "User-Agent": userAgent,
          },
        },
        (res) => res.text()
      );
    },

    fetchSubjectListJson(term: string): Promise<SubjectListItem[]> {
      const url = `${SOC_BASE_URL}/subject-list.json?selectedTerm=${encodeURIComponent(term)}`;
      return requestWithRetry(
        url,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            "User-Agent": userAgent,
          },
        },
        async (res) => {
          const data: unknown = await res.json();
          if (!Array.isArray(data)) {
            throw new UpstreamSocError(`Unexpected subject-list payload for ${term}`, {
              url,
              retryable: false,
            });
          }
          return data.filter(
            (item): item is SubjectListItem =>
              typeof item === "object" &&
              item !== null &&
              typeof (item as SubjectListItem).code === "string" &&
              typeof (item as SubjectListItem).value === "string"
          );
        }
      );
    },

    fetchSubjectFirstPage(
      term: string,
      subjectCode: string,
      cookie: string | null = null
    ): Promise<FetchPageResult> {
      const url = `${SOC_BASE_URL}/scheduleOfClassesStudentResult.htm`;
      const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/html",
        "User-Agent": userAgent,
      };
      if (cookie) headers.Cookie = cookie;

      return requestWithRetry(
        url,
        {
          method: "POST",
          headers,
          body: subjectSearchBody(term, subjectCode),
        },
        async (res) => ({
          html: await res.text(),
          cookie: mergeCookies(cookie ?? "", res),
        })
      );
    },

    fetchSubjectResultPage(page: number, cookie: string): Promise<string> {
      const url = new URL(`${SOC_BASE_URL}/scheduleOfClassesStudentResult.htm`);
      url.searchParams.set("page", String(page));
      return requestWithRetry(
        url.toString(),
        {
          method: "GET",
          headers: {
            Cookie: cookie,
            Accept: "text/html",
            "User-Agent": userAgent,
          },
        },
        (res) => res.text()
      );
    },
  };
}
