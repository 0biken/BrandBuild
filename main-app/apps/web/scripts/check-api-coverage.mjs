// Fails if the web client calls a path that docs/api/openapi.yaml doesn't define.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = join(here, "../src/lib/api");
const spec = readFileSync(join(here, "../../../../docs/api/openapi.yaml"), "utf8");

const normalise = (path) => path.replace(/\{[^}]*\}/g, "{}");

const specPaths = new Set([...spec.matchAll(/^ {2}(\/v1\S*):\s*$/gm)].map((m) => normalise(m[1])));
const specOperations = (spec.split(/^paths:\s*$/m)[1].split(/^components:/m)[0].match(/^ {4}(get|post|put|patch|delete):\s*$/gm) ?? []).length;

const called = new Map();
for (const file of readdirSync(apiDir)) {
  if (!file.endsWith(".ts") || file.endsWith(".test.ts") || file.endsWith(".gen.ts")) continue;
  const source = readFileSync(join(apiDir, file), "utf8");
  for (const match of source.matchAll(/["`](?:\$\{API_URL\})?(\/v1\/[^"`?]*)/g)) {
    called.set(normalise(match[1].replace(/\$\{[^}]*\}/g, "{}")), file);
  }
}

const missing = [...called].filter(([path]) => !specPaths.has(path));
for (const [path, file] of missing) console.error(`Not in the contract: ${path} (${file})`);
console.log(`${called.size - missing.length}/${called.size} client paths are in the contract; the spec has ${specOperations} operations.`);
if (missing.length) process.exit(1);
