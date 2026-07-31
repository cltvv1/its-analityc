import assert from "node:assert/strict";
import test from "node:test";
import {
  isAnnualItsPurchase,
  isTrackedAssignmentOffer,
} from "../scripts/atol-rules.mjs";

test("assignment counter includes only the annual ИТС offer", () => {
  assert.equal(
    isTrackedAssignmentOffer("АТОЛ Connect. ИТС на 1 год"),
    true,
  );
  assert.equal(
    isTrackedAssignmentOffer(
      "  АТОЛ   Connect. ИТС для ФР и Ньюджер на 15 месяцев ",
    ),
    false,
  );
  assert.equal(
    isTrackedAssignmentOffer("АТОЛ Connect. ИТС для Sigma на 12 месяцев"),
    false,
  );
  assert.equal(isTrackedAssignmentOffer("АТОЛ Connect. Техподдержка"), false);
});

test("purchase fallback matches only the annual ИТС product", () => {
  assert.equal(isAnnualItsPurchase("АТОЛ Connect. ИТС на 1 год"), true);
  assert.equal(
    isAnnualItsPurchase("АТОЛ Connect. ИТС для ФР и Ньюджер на 15 месяцев"),
    false,
  );
  assert.equal(
    isAnnualItsPurchase("АТОЛ Connect. ИТС для Sigma на 12 месяцев"),
    false,
  );
});
