import assert from "node:assert/strict";
import test from "node:test";
import { resolvePurchaseQuantity } from "../scripts/purchase-quantity.mjs";

test("keeps a normal quantity reported by LKP", () => {
  const result = resolvePurchaseQuantity({
    shipment_quantity: 20,
    shipment_price: 1800,
    shipment_sum: 36_000,
  });

  assert.equal(result.quantity, 20);
  assert.equal(result.quantitySource, "reported");
});

test("derives a large discounted shipment quantity when LKP reports one", () => {
  const result = resolvePurchaseQuantity({
    shipment_quantity: 1,
    shipment_price: "1 800,00",
    shipment_sum: "3 060 000,00",
  });

  assert.deepEqual(result, {
    quantity: 1700,
    reportedQuantity: 1,
    quantitySource: "amount-derived",
    unitPrice: 1800,
    unitPriceField: "shipment_price",
    amount: 3_060_000,
    amountField: "shipment_sum",
  });
});

test("keeps a one-licence purchase when price and amount agree", () => {
  const result = resolvePurchaseQuantity({
    shipment_quantity: 1,
    shipment_price: 1800,
    shipment_sum: 1800,
  });

  assert.equal(result.quantity, 1);
  assert.equal(result.quantitySource, "reported");
});

test("does not infer a quantity from an inconsistent amount", () => {
  const result = resolvePurchaseQuantity({
    shipment_quantity: 1,
    shipment_price: 1800,
    shipment_sum: 3_060_001,
  });

  assert.equal(result.quantity, 1);
  assert.equal(result.quantitySource, "reported");
});
