/**
 * Enforce package import boundaries for ComposeUI workspaces.
 *
 * Rules:
 * 1. packages/editor, packages/operation-log, apps/** may only import core as
 *    bare `@composeui/core` (no deep subpaths, no packages/core/src paths).
 * 2. packages/core/src/query/** must not import kernel/commands or kernel/plugin.
 * 3. packages/core must not import editor, DOM-oriented packages, or framework UI
 *    (vue/react/angular/dockview/lucide, etc.).
 *
 * Usage: node scripts/check-package-boundaries.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const errors = []

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".git") continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !name.endsWith(".d.ts")) out.push(p)
  }
  return out
}

const importRe = /from\s+["']([^"']+)["']/g

function isConsumerOfCore(rel) {
  return (
    rel.startsWith("packages/editor/") ||
    rel.startsWith("packages/operation-log/") ||
    rel.startsWith("apps/")
  )
}

function isIllegalCoreImport(spec) {
  if (spec === "@composeui/core") return false
  if (spec.startsWith("@composeui/core/")) return true
  if (spec.includes("packages/core/src")) return true
  if (spec.includes("/core/src/") || spec.includes("/core/src")) return true
  return false
}

function isIllegalQueryImport(spec) {
  return (
    spec.includes("kernel/commands") ||
    spec.includes("kernel/plugin") ||
    spec.endsWith("/commands") ||
    spec.includes("/commands/")
  )
}

/** Packages core must never depend on (framework / editor chrome). */
const CORE_FORBIDDEN_PACKAGES = [
  "@composeui/editor",
  "@composeui/operation-log",
  "dockview",
  "lucide",
  "vue",
  "react",
  "react-dom",
  "angular",
  "@angular/core",
]

function isIllegalCoreDependency(spec) {
  if (CORE_FORBIDDEN_PACKAGES.includes(spec)) return true
  if (CORE_FORBIDDEN_PACKAGES.some((pkg) => spec.startsWith(`${pkg}/`))) return true
  if (spec.includes("packages/editor/") || spec.includes("packages/operation-log/")) return true
  return false
}

function checkFile(file) {
  const rel = relative(root, file).split("\\").join("/")
  const text = readFileSync(file, "utf8")
  let m
  importRe.lastIndex = 0
  while ((m = importRe.exec(text))) {
    const spec = m[1]

    if (isConsumerOfCore(rel) && isIllegalCoreImport(spec)) {
      errors.push(`${rel}: illegal core import ${spec}`)
    }

    if (rel.startsWith("packages/core/src/query/") && isIllegalQueryImport(spec)) {
      errors.push(`${rel}: query must not import commands/plugin (${spec})`)
    }

    if (rel.startsWith("packages/core/") && isIllegalCoreDependency(spec)) {
      errors.push(`${rel}: core must not depend on ${spec}`)
    }
  }
}

const packagesDir = join(root, "packages")
const appsDir = join(root, "apps")
const files = [...walk(packagesDir), ...walk(appsDir)]

for (const file of files) {
  checkFile(file)
}

if (errors.length > 0) {
  console.error("Package boundary violations:\n" + errors.join("\n"))
  process.exit(1)
}

console.log("Package boundaries OK")
