import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import type { Env, Hono } from "hono";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

function contentTypeFor(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

async function safeStat(filePath: string) {
  try {
    return await stat(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export function registerStaticRoutes<E extends Env>(app: Hono<E>, clientDistDir: string): void {
  const distRoot = resolve(clientDistDir);
  const distPrefix = distRoot.endsWith(sep) ? distRoot : `${distRoot}${sep}`;
  const indexHtmlPath = join(distRoot, "index.html");

  app.get("*", async (c) => {
    const pathname = new URL(c.req.url).pathname;
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return c.notFound();
    }

    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(pathname);
    } catch {
      return c.text("bad path", 400);
    }

    if (decodedPath.includes("\0")) {
      return c.text("bad path", 400);
    }

    const relPath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
    const resolvedPath = resolve(distRoot, relPath);

    if (resolvedPath !== distRoot && !resolvedPath.startsWith(distPrefix)) {
      return c.text("bad path", 400);
    }

    const indexInfo = await safeStat(indexHtmlPath);
    if (!indexInfo?.isFile()) {
      return c.text(
        "EmptyBoard API — run `npm run build` for the UI, or `npm run dev` (Vite proxies /api to this server).",
        200,
        { "Content-Type": "text/plain; charset=utf-8" }
      );
    }

    if (resolvedPath !== distRoot) {
      const targetInfo = await safeStat(resolvedPath);
      if (targetInfo?.isFile()) {
        const buf = await readFile(resolvedPath);
        return c.body(buf, 200, { "Content-Type": contentTypeFor(resolvedPath) });
      }
      if (targetInfo?.isDirectory()) {
        return c.notFound();
      }
    }

    const html = await readFile(indexHtmlPath, "utf-8");
    return c.html(html);
  });
}
