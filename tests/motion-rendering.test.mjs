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

test("frame-driven objects do not restart CSS position transitions", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: match[1].split(",").map((value) => value.trim()),
    declarations: match[2],
  }));

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
