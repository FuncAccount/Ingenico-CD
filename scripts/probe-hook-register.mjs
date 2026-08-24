// Preload that installs the resolver below. Must be passed with --import so it
// registers BEFORE the v0 runtime's own loader, which otherwise resolves first
// and every "@/..." import fails.
import { register } from "node:module"
import { pathToFileURL } from "node:url"

register("./probe-hook.mjs", pathToFileURL(import.meta.filename))
