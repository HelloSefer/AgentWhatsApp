import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_CART_TARGET_ITEM_COUNT } from "../../cart-state.service";
import { evaluateCartPlanningActions } from "../actions/cart-planning-action-eval.service";
import { evaluateCartPlanning } from "../cart-planning-eval.service";
import {
  normalizeCartCustomQuantityInput,
} from "./cart-quantity-input-normalizer.service";

type EvaluationCase = { name: string; passed: boolean; detail?: string };

export type CartQuantityInputEvaluationResult = {
  total: number;
  passed: number;
  failed: number;
  cases: EvaluationCase[];
};

function add(cases: EvaluationCase[], name: string, passed: boolean, detail?: string): void {
  cases.push({ name, passed, detail: passed ? undefined : detail });
}

function hasQuantity(value: unknown, expected: number): boolean {
  const result = normalizeCartCustomQuantityInput(value);
  return result.success && result.quantity === expected;
}

/** Permanent deterministic regression suite for custom quantity normalization. */
export function evaluateCartQuantityInput(): CartQuantityInputEvaluationResult {
  const cases: EvaluationCase[] = [];

  add(cases, '"4" resolves to 4', hasQuantity("4", 4));
  add(cases, '"10" resolves to 10', hasQuantity("10", 10));
  const arabicFour = normalizeCartCustomQuantityInput("٤");
  add(cases, "Arabic-Indic 4 resolves to 4", arabicFour.success && arabicFour.quantity === 4 && arabicFour.source === "ARABIC_INDIC_DIGITS");
  add(cases, "Arabic-Indic 10 resolves to 10", hasQuantity("١٠", 10));
  add(cases, '"بغيت 5" resolves to 5', hasQuantity("بغيت 5", 5));
  add(cases, '"بغيت 5 قطع" resolves to 5', hasQuantity("بغيت 5 قطع", 5));
  add(cases, '"5 ديال القطع" resolves to 5', hasQuantity("5 ديال القطع", 5));
  add(cases, '"bghit 6" resolves to 6', hasQuantity("bghit 6", 6));
  const word = normalizeCartCustomQuantityInput("جوج");
  add(cases, "supported unambiguous quantity word remains supported", word.success && word.quantity === 2 && word.source === "SUPPORTED_QUANTITY_WORD");
  add(cases, "Arabizi supported quantity word remains supported", hasQuantity("bghit jouj", 2));

  add(cases, "zero is rejected", normalizeCartCustomQuantityInput("0").failureCode === "INVALID_QUANTITY");
  add(cases, "negative is rejected", normalizeCartCustomQuantityInput("-4").failureCode === "INVALID_QUANTITY");
  add(cases, "decimal is rejected", normalizeCartCustomQuantityInput("4.5").failureCode === "INVALID_QUANTITY");
  add(cases, "scientific notation is rejected", normalizeCartCustomQuantityInput("1e2").failureCode === "INVALID_QUANTITY");
  add(cases, "excessive quantity is rejected", normalizeCartCustomQuantityInput(String(MAX_CART_TARGET_ITEM_COUNT + 1)).failureCode === "QUANTITY_TOO_LARGE");
  add(cases, "empty input is rejected", normalizeCartCustomQuantityInput("   ").failureCode === "EMPTY_INPUT");
  add(cases, "excessively long input is rejected", normalizeCartCustomQuantityInput("4".repeat(121)).failureCode === "INPUT_TOO_LONG");
  add(cases, "two conflicting numbers are rejected", normalizeCartCustomQuantityInput("بغيت 4 و 5").failureCode === "AMBIGUOUS_QUANTITY");
  add(cases, "quantity range is rejected", normalizeCartCustomQuantityInput("4 أو 5").failureCode === "AMBIGUOUS_QUANTITY");
  add(cases, "Moroccan phone number is rejected", normalizeCartCustomQuantityInput("0612345678").failureCode === "PHONE_LIKE_INPUT");
  add(cases, "separated Moroccan phone number is rejected", normalizeCartCustomQuantityInput("06 12 34 56 78").failureCode === "PHONE_LIKE_INPUT");
  add(cases, "international phone number is rejected", normalizeCartCustomQuantityInput("+212612345678").failureCode === "PHONE_LIKE_INPUT");
  add(cases, "price with darija currency is rejected", normalizeCartCustomQuantityInput("200 درهم").failureCode === "PRICE_LIKE_INPUT");
  add(cases, "price with currency symbol is rejected", normalizeCartCustomQuantityInput("200$").failureCode === "PRICE_LIKE_INPUT");
  add(cases, "percentage is rejected", normalizeCartCustomQuantityInput("20%").failureCode === "NO_QUANTITY_FOUND");
  add(cases, "date-like input is rejected", normalizeCartCustomQuantityInput("12/07/2026").failureCode === "UNSUPPORTED_FORMAT");
  add(cases, "order-id-like input is rejected", normalizeCartCustomQuantityInput("ORD-1234").failureCode === "UNSUPPORTED_FORMAT");
  add(cases, "size-specific phrase is not treated as quantity", normalizeCartCustomQuantityInput("مقاس 38").failureCode === "UNSUPPORTED_FORMAT");
  add(cases, "normal question is rejected", normalizeCartCustomQuantityInput("شنو الثمن؟").failureCode === "NO_QUANTITY_FOUND");
  add(cases, "incidental number is rejected", normalizeCartCustomQuantityInput("عندي 4 أسئلة").failureCode === "NO_QUANTITY_FOUND");

  const input = "  بغيت 6  ";
  const before = input;
  const normalized = normalizeCartCustomQuantityInput(input);
  add(cases, "input string is not mutated", input === before && normalized.normalizedText === "بغيت 6");
  const first = normalizeCartCustomQuantityInput("5 ديال القطع");
  const second = normalizeCartCustomQuantityInput("5 ديال القطع");
  add(cases, "repeated normalization is deterministic", JSON.stringify(first) === JSON.stringify(second));
  add(cases, "C1 quantity limit is consistent", hasQuantity(String(MAX_CART_TARGET_ITEM_COUNT), MAX_CART_TARGET_ITEM_COUNT) && normalizeCartCustomQuantityInput(String(MAX_CART_TARGET_ITEM_COUNT + 1)).failureCode === "QUANTITY_TOO_LARGE");

  const c1 = evaluateCartPlanning();
  const c2b = evaluateCartPlanningActions();
  add(cases, "existing C1 planning evaluator remains passing", c1.failed === 0);
  add(cases, "existing C2B action evaluator remains passing", c2b.failed === 0);

  const moduleSource = ["cart-quantity-input.types.ts", "cart-quantity-input-normalizer.service.ts"]
    .map((file) => readFileSync(join(process.cwd(), "src", "modules", "agent", "order", "planning", "quantity", file), "utf8"))
    .join("\n");
  add(cases, "quantity module has no AI dependency", !/from\s+["'][^"']*(?:ollama|openai|ai\/)/i.test(moduleSource));
  add(cases, "quantity module has no cart or planning mutation dependency", !/(setCartPlanning|clearCartPlanning|selectConfiguredOffer|selectStandardTargetQuantity|CartDraft)/i.test(moduleSource));
  add(cases, "quantity module has no runtime transport or persistence dependency", !/from\s+["'][^"']*(?:whatsapp|cloud|receipt|valkey|redis|database|prisma|typeorm)/i.test(moduleSource));

  const passed = cases.filter((test) => test.passed).length;
  return { total: cases.length, passed, failed: cases.length - passed, cases };
}
