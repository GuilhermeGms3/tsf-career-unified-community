import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { auditCssTokens } from "../scripts/check-css-tokens.mjs";

test("frontend não utiliza CSS custom properties sem definição", async () => {
  const result = await auditCssTokens(path.resolve("public"));
  assert.deepEqual(result.undefined, []);
});
