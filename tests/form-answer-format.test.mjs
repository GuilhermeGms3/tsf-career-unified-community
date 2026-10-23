import assert from "node:assert/strict";
import test from "node:test";
import { validateFormAnswer } from "../src/application/form-answer-format.mjs";
import { GenericAdapter } from "../src/automation/ats/generic/generic-adapter.mjs";

test("select aceita label ou valor exatos sem reinterpretar nivel B2", () => {
  const field = { type: "select-one", options: [{ label: "Intermediate", value: "3" }] };
  assert.deepEqual(validateFormAnswer(field, " intermediate "), { valid: true, value: "3" });
  assert.deepEqual(validateFormAnswer(field, "3"), { valid: true, value: "3" });
  assert.equal(validateFormAnswer(field, "Nivel B2").valid, false);
});

test("numero rejeita A combinar e aceita numero decimal", () => {
  assert.equal(validateFormAnswer({ fieldType: "number" }, "A combinar").valid, false);
  assert.deepEqual(validateFormAnswer({ fieldType: "number" }, "40,50"), { valid: true, value: "40.50" });
});

test("resposta conhecida incompativel volta a exigir resposta antes do navegador", () => {
  const field = { externalKey: "notice", type: "number", semanticKey: "APPLICATION.NOTICE_PERIOD", required: true, confidence: .99 };
  const mapped = new GenericAdapter().mapFields({ fields: [field] }, { get: () => null }, [{ externalKey: "notice", answerStatus: "KNOWN", answerValue: "A combinar", answerSource: "USER_CONFIRMED" }]);
  assert.equal(mapped[0].answerStatus, "USER_REQUIRED");
  assert.equal(mapped[0].answerFormatInvalid, true);
  assert.match(mapped[0].reasonRequired, /número/);
});
