function normalizeOfferName(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е");
}

const TRACKED_ASSIGNMENT_OFFERS = new Set([
  "атол connect. итс на 1 год",
]);

export function isTrackedAssignmentOffer(value) {
  return TRACKED_ASSIGNMENT_OFFERS.has(normalizeOfferName(value));
}

export function isAnnualItsPurchase(value) {
  return normalizeOfferName(value) === "атол connect. итс на 1 год";
}
