import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/* The orphan-class guard (audit follow-up): every class selector in styles.css
   must be referenced somewhere in the source, or it is dead weight. The check
   is substring-based (conservative: dynamic composition like `"be-" + backend`
   counts as a reference via the allowlist below; a class name that is a
   substring of a longer referenced name also passes). The audit that added
   this found 28 orphans by hand — this keeps the count at zero. */

/** classes assembled at runtime from string parts, invisible to a text scan */
const DYNAMIC = new Set(["be-q8", "role-prod", "role-cur", "chat-you"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|html)$/.test(f) && !p.includes("styles")) out.push(p);
  }
  return out;
}

describe("styles.css", () => {
  it("has no unreferenced class selectors", () => {
    const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8")
      // strip comments so prose like "nothing.tech-inspired" is not read as a selector
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const classes = [...new Set([...css.matchAll(/\.([a-zA-Z][\w-]+)/g)].map((m) => m[1]))];

    let src = readFileSync(join(process.cwd(), "index.html"), "utf8");
    for (const f of walk(join(process.cwd(), "src"))) src += readFileSync(f, "utf8");

    const dead = classes.filter((c) => !DYNAMIC.has(c) && !src.includes(c));
    expect(dead, `dead CSS classes: ${dead.join(", ")}`).toEqual([]);
  });
});
