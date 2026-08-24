// Resolves the two things plain Node cannot: the "@/" alias, and the
// extension-less relative imports TypeScript allows.
import { existsSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function tryExts(base) {
  for (const ext of [".ts", ".tsx", ".mts", ".js"]) {
    if (existsSync(base + ext)) return base + ext
  }
  if (existsSync(path.join(base, "index.ts"))) return path.join(base, "index.ts")
  return null
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const hit = tryExts(path.join(ROOT, specifier.slice(2)))
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true }
  }
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
    if (!path.extname(base)) {
      const hit = tryExts(base)
      if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true }
    }
  }
  // `server-only` is a Next marker with no meaning outside the bundler.
  if (specifier === "server-only") {
    return { url: pathToFileURL(path.join(ROOT, "scripts/empty-shim.mjs")).href, shortCircuit: true }
  }
  return next(specifier, context)
}
