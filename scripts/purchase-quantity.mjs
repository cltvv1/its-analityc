const UNIT_PRICE_FIELDS = [
  "shipment_unit_price",
  "shipment_price",
  "unit_price",
  "product_price",
  "price",
];

const AMOUNT_FIELDS = [
  "shipment_amount",
  "shipment_sum",
  "shipment_total",
  "total_amount",
  "total_sum",
  "amount",
  "sum",
  "total",
];

function parseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const normalized = value
    .replace(/[\s\u00a0]/g, "")
    .replace(",", ".")
    .trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;

  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function firstNumericField(item, fields) {
  for (const field of fields) {
    const value = parseNumber(item?.[field]);
    if (value !== null) return { field, value };
  }
  return null;
}

/**
 * LKP occasionally reports a large discounted shipment as one item even when
 * its line amount and unit price describe an integral number of licences.
 */
export function resolvePurchaseQuantity(item) {
  const reportedQuantity = parseNumber(item?.shipment_quantity);
  if (reportedQuantity === null || reportedQuantity <= 0) return null;

  const result = {
    quantity: reportedQuantity,
    reportedQuantity,
    quantitySource: "reported",
    unitPrice: null,
    unitPriceField: null,
    amount: null,
    amountField: null,
  };

  // Never override a normal quantity reported by LKP.
  if (reportedQuantity !== 1) return result;

  const price = firstNumericField(item, UNIT_PRICE_FIELDS);
  const amount = firstNumericField(item, AMOUNT_FIELDS);
  if (!price || !amount || price.value <= 0 || amount.value <= 0) return result;

  result.unitPrice = price.value;
  result.unitPriceField = price.field;
  result.amount = amount.value;
  result.amountField = amount.field;

  const calculatedQuantity = Math.round(amount.value / price.value);
  const roundingDifference = Math.abs(
    amount.value - price.value * calculatedQuantity,
  );

  // Monetary values may be rounded to kopecks. Do not infer a quantity from
  // a non-integral or otherwise inconsistent price/amount pair.
  if (calculatedQuantity > 1 && roundingDifference <= 0.01) {
    result.quantity = calculatedQuantity;
    result.quantitySource = "amount-derived";
  }

  return result;
}
