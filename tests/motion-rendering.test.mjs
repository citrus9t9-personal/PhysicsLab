import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const animatedSelectors = [
  ".projectile-object",
  ".incline-block",
  ".hanging-block",
  ".collision-block",
  ".spring-block",
];

async function readStyleRules() {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: match[1].split(",").map((value) => value.trim()),
    declarations: match[2],
  }));
}

test("frame-driven objects do not restart CSS position transitions", async () => {
  const rules = await readStyleRules();

  for (const selector of animatedSelectors) {
    const matchingRules = rules.filter((rule) => rule.selectors.includes(selector));

    assert.ok(matchingRules.length > 0, `Expected a CSS rule for ${selector}`);
    for (const rule of matchingRules) {
      assert.doesNotMatch(
        rule.declarations,
        /transition\s*:/,
        `${selector} should render each requestAnimationFrame position immediately`,
      );
    }
    assert.ok(
      matchingRules.some((rule) => /will-change\s*:/.test(rule.declarations)),
      `Expected ${selector} to declare its changing position`,
    );
  }
});

test("incline block and trail inherit the ramp rotation", async () => {
  const rules = await readStyleRules();

  for (const selector of [".incline-block", ".incline-ghost"]) {
    const declarations = rules
      .filter((rule) => rule.selectors.includes(selector))
      .map((rule) => rule.declarations)
      .join("\n");

    assert.doesNotMatch(declarations, /transform\s*:/);
    assert.doesNotMatch(declarations, /block-counter-angle/);
  }
});
