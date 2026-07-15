import type { ConversationSession } from "../agent-brain.types";
import type { RequiredOrderField } from "../config/required-fields.types";
import type { ProductContext } from "../product-context.types";
import { analyzeAIIntentWithMeta } from "../ai/ai-intent-router.service";
import { validateContextualCandidate } from "./contextual-field-validator.service";
import { extractDeterministicFieldCandidates } from "./deterministic-field-extractor.service";
import { buildOrderUnderstandingContext, isFieldEffectivelyRequired } from "./understanding-context.builder";
import {
  getOrderUnderstandingDiagnostics,
  understandContextualOrderMessage,
} from "./contextual-order-understanding.service";
import {
  buildOptionalFieldPrompt,
  getNextOptionalField,
  getOptionalFieldDialogueState,
  markOptionalFieldPrompted,
  reconcileOptionalFieldDialogue,
  skipOptionalField,
} from "./optional-field-dialogue.service";
import { isContextualOrderUnderstandingEvaluationEnabled } from "./evaluation-access.policy";
import { classifyOrderMessageDisposition } from "./message-disposition.service";
import { applyUnderstandingDecision } from "./order-draft-mutation.service";
import { validateOrderDraftIntegrity } from "./order-draft-integrity.service";

type EvaluationResult = {
  name: string;
  passed: boolean;
  details?: string;
};

const productContext: ProductContext = {
  productId: "contextual-product",
  businessName: "متجر تجريبي",
  productName: "منتج تجريبي",
  price: "100",
  currency: "MAD",
};

const baseFields: RequiredOrderField[] = [
  { key: "fullName", label: "الاسم", required: true, enabled: true, source: "customerField", askOrder: 1, captureMode: "OPEN_TEXT" },
  { key: "phone", label: "الهاتف", required: true, enabled: true, source: "customerField", askOrder: 2, captureMode: "PHONE" },
  { key: "city", label: "المدينة", required: true, enabled: true, source: "customerField", askOrder: 3, captureMode: "LOCATION" },
  { key: "address", label: "العنوان", required: true, enabled: true, source: "customerField", askOrder: 4, captureMode: "ADDRESS", allowMultipleMessages: true },
  { key: "quantity", label: "الكمية", required: true, enabled: true, source: "customerField", askOrder: 5, captureMode: "NUMERIC", minValue: 1, maxValue: 10 },
  { key: "color", label: "اللون", required: true, enabled: true, source: "productOption", askOrder: 6, captureMode: "CONFIGURED_ENUM", options: ["أسود", "وردي"] },
];

function createSession(collected: Record<string, string | number | undefined> = {}): ConversationSession {
  const now = new Date().toISOString();
  return {
    sessionId: "contextual-eval",
    customerId: "contextual-eval",
    sellerId: "contextual-eval",
    messages: [],
    orderState: {
      orderCycleId: "cycle-contextual-eval",
      collected: collected as ConversationSession["orderState"]["collected"],
      missingFields: baseFields.filter((field) => field.required && !collected[field.key]).map((field) => field.key),
      isComplete: false,
      awaitingConfirmation: false,
      confirmed: false,
      lastUpdatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function getValidatedCandidates(input: { message: string; fields?: RequiredOrderField[]; collected?: Record<string, string | number | undefined> }) {
  const fields = input.fields || baseFields;
  const session = createSession(input.collected);
  const context = buildOrderUnderstandingContext({
    customerId: "contextual-eval",
    message: input.message,
    productContext,
    session,
    fields,
  });
  const candidates = extractDeterministicFieldCandidates(context);
  const valid = candidates.flatMap((candidate) => {
    const result = validateContextualCandidate(candidate, context);
    return result.candidate ? [result.candidate] : [];
  });

  return { context, candidates, valid };
}

export async function evaluateContextualOrderUnderstanding(): Promise<{
  summary: { total: number; passed: number; failed: number; passedAll: boolean };
  results: EvaluationResult[];
}> {
  const results: EvaluationResult[] = [];
  const add = (name: string, passed: boolean, details?: string) => results.push({ name, passed, details });
  const unseenOne = "دوار النخيل الجديدة";
  const unseenTwo = "منطقة الأمل الشرقية";

  for (const locality of [unseenOne, unseenTwo]) {
    const { valid } = getValidatedCandidates({
      message: locality,
      collected: { fullName: "عمر", phone: "0612345678", address: "حي السلام", quantity: 1, color: "أسود" },
    });
    add(`open-world city accepts ${locality}`, valid.some((candidate) => candidate.fieldKey === "city" && candidate.value === locality));
  }

  const productFirstFields: RequiredOrderField[] = [
    { key: "size", label: "المقاس", required: true, enabled: true, source: "productOption", askOrder: 1, captureMode: "CONFIGURED_ENUM", options: ["38", "39"] },
    { key: "color", label: "اللون", required: true, enabled: true, source: "productOption", askOrder: 2, captureMode: "CONFIGURED_ENUM", options: ["أسود", "وردي"] },
    { key: "quantity", label: "الكمية", required: true, enabled: true, source: "customerField", askOrder: 3, captureMode: "NUMERIC", minValue: 1, maxValue: 10 },
    ...baseFields.slice(0, 4).map((field, index) => ({ ...field, askOrder: index + 4 })),
  ];
  const voluntaryLocality = getValidatedCandidates({
    message: unseenOne,
    fields: productFirstFields,
    collected: { fullName: "عمر", phone: "0612345678", address: "حي السلام" },
  });
  add(
    "open-world city can be volunteered before its ask turn",
    voluntaryLocality.context.awaitedField?.key === "size" &&
      voluntaryLocality.valid.some((candidate) => candidate.fieldKey === "city" && candidate.value === unseenOne),
  );

  const actionWhileCity = getValidatedCandidates({ message: "نعم" });
  add("action while awaiting city is not a city", !actionWhileCity.valid.some((candidate) => candidate.fieldKey === "city"));

  const optionalAddress: RequiredOrderField = { ...baseFields[3], required: false, requirement: "OPTIONAL", askPolicy: "ASK_ONCE" };
  const disabledAddress: RequiredOrderField = { ...baseFields[3], required: false, enabled: false, requirement: "DISABLED" };
  const conditionalAddress: RequiredOrderField = { ...baseFields[3], required: false, requirement: "CONDITIONAL", condition: { fieldKey: "deliveryMethod", equals: "HOME_DELIVERY" } };
  add("optional address does not become effective required", !isFieldEffectivelyRequired(optionalAddress, {}));
  add("disabled address does not become effective required", !isFieldEffectivelyRequired(disabledAddress, {}));
  add("conditional address is inactive without condition", !isFieldEffectivelyRequired(conditionalAddress, {}));
  add("conditional address activates from configured condition", isFieldEffectivelyRequired(conditionalAddress, { deliveryMethod: "HOME_DELIVERY" }));

  const optionalCustomerNote: RequiredOrderField = {
    key: "customerNote",
    label: "ملاحظة للطلب",
    required: false,
    enabled: true,
    source: "customerField",
    askOrder: 10,
    captureMode: "OPEN_TEXT",
    requirement: "OPTIONAL",
    askPolicy: "ASK_ONCE",
  };
  const optionalBeforeConfirmation: RequiredOrderField = {
    ...optionalAddress,
    askPolicy: "ASK_BEFORE_CONFIRMATION",
  };
  const doNotAskOptional: RequiredOrderField = {
    ...optionalCustomerNote,
    key: "postalCode",
    label: "الرمز البريدي",
    askPolicy: "DO_NOT_ASK",
  };
  const requiredFieldsComplete = {
    fullName: "عمر",
    phone: "0612345678",
    city: "مراكش",
    address: "حي السلام",
    quantity: 1,
    color: "أسود",
  };
  const optionalFields = [
    ...baseFields.filter((field) => field.key !== "address"),
    optionalBeforeConfirmation,
    optionalCustomerNote,
    doNotAskOptional,
  ];
  const requiredFieldsWithoutOptionalAddress = {
    fullName: requiredFieldsComplete.fullName,
    phone: requiredFieldsComplete.phone,
    city: requiredFieldsComplete.city,
    quantity: requiredFieldsComplete.quantity,
    color: requiredFieldsComplete.color,
  };
  const freshOptionalDialogue = getOptionalFieldDialogueState({ orderCycleId: "cycle-optional" });
  const nextOptional = getNextOptionalField({
    fields: optionalFields,
    collected: requiredFieldsWithoutOptionalAddress,
    dialogue: freshOptionalDialogue,
  });
  add("optional DO_NOT_ASK is never scheduled", nextOptional?.key === "customerNote");
  add("ASK_ONCE is scheduled before confirmation-only fields", nextOptional?.key === "customerNote");
  const promptedOptional = nextOptional
    ? markOptionalFieldPrompted({ dialogue: freshOptionalDialogue, fieldKey: nextOptional.key })
    : freshOptionalDialogue;
  const optionalPrompt = nextOptional ? buildOptionalFieldPrompt(nextOptional) : undefined;
  add("generic optional prompt includes stable skip action", optionalPrompt?.ui.options?.[0]?.id === "field:skip:customerNote");
  const customSkip = skipOptionalField({
    fieldKey: "customerNote",
    fields: optionalFields,
    collected: requiredFieldsWithoutOptionalAddress,
    dialogue: promptedOptional,
  });
  add("generic custom field skip is accepted", customSkip.accepted && customSkip.dialogue.skippedFieldKeys.includes("customerNote"));
  const nextAfterCustomSkip = getNextOptionalField({
    fields: optionalFields,
    collected: requiredFieldsWithoutOptionalAddress,
    dialogue: customSkip.dialogue,
  });
  add("ASK_BEFORE_CONFIRMATION schedules after ASK_ONCE is resolved", nextAfterCustomSkip?.key === "address");
  const addressPrompted = nextAfterCustomSkip
    ? markOptionalFieldPrompted({ dialogue: customSkip.dialogue, fieldKey: nextAfterCustomSkip.key })
    : customSkip.dialogue;
  const addressSkip = skipOptionalField({
    fieldKey: "address",
    fields: optionalFields,
    collected: requiredFieldsWithoutOptionalAddress,
    dialogue: addressPrompted,
  });
  add("generic address skip is accepted for active optional field", addressSkip.accepted && addressSkip.dialogue.skippedFieldKeys.includes("address"));
  const requiredSkip = skipOptionalField({
    fieldKey: "city",
    fields: optionalFields,
    collected: requiredFieldsWithoutOptionalAddress,
    dialogue: addressPrompted,
  });
  add("required field skip is rejected", !requiredSkip.accepted && requiredSkip.reason === "field_not_optional");
  const disabledSkip = skipOptionalField({
    fieldKey: "address",
    fields: [...baseFields, disabledAddress],
    collected: requiredFieldsWithoutOptionalAddress,
    dialogue: promptedOptional,
  });
  add("disabled field skip is rejected", !disabledSkip.accepted);
  const nextCycleDialogue = getOptionalFieldDialogueState({
    orderCycleId: "cycle-optional-next",
    existing: customSkip.dialogue,
  });
  add("new cycle receives fresh optional dialogue state", nextCycleDialogue.askedFieldKeys.length === 0 && nextCycleDialogue.skippedFieldKeys.length === 0);
  const staleSkip = skipOptionalField({
    fieldKey: "address",
    fields: optionalFields,
    collected: requiredFieldsComplete,
    dialogue: nextCycleDialogue,
  });
  add("stale skip without active prompt is rejected", !staleSkip.accepted && staleSkip.reason === "field_not_active");
  const voluntaryValueDialogue = reconcileOptionalFieldDialogue({
    dialogue: freshOptionalDialogue,
    collected: { ...requiredFieldsWithoutOptionalAddress, customerNote: "خلي الاتصال بعد العصر" },
    fields: optionalFields,
  });
  add("voluntary optional value prevents re-prompt", voluntaryValueDialogue.askedFieldKeys.includes("customerNote"));
  const conditionalOptional: RequiredOrderField = {
    ...optionalCustomerNote,
    key: "neighborhood",
    condition: { fieldKey: "deliveryMethod", equals: "HOME_DELIVERY" },
  };
  add("conditional optional waits until configured condition matches", !getNextOptionalField({
    fields: [...baseFields, conditionalOptional],
    collected: requiredFieldsWithoutOptionalAddress,
    dialogue: freshOptionalDialogue,
  }));
  add("conditional optional is reevaluated when controlling field changes", getNextOptionalField({
    fields: [...baseFields, conditionalOptional],
    collected: { ...requiredFieldsWithoutOptionalAddress, deliveryMethod: "HOME_DELIVERY" },
    dialogue: freshOptionalDialogue,
  })?.key === "neighborhood");
  const isolatedSecondConversation = getOptionalFieldDialogueState({ orderCycleId: "cycle-other" });
  add("optional dialogue state stays isolated between conversations", isolatedSecondConversation.skippedFieldKeys.length === 0);
  add("context recent messages remain bounded to six turns", buildOrderUnderstandingContext({
    customerId: "contextual-bounded",
    message: "سلام",
    productContext,
    session: { ...createSession(), messages: Array.from({ length: 12 }, (_, index) => ({ role: "customer" as const, text: `turn ${index}`, timestamp: new Date().toISOString() })) },
    fields: baseFields,
  }).recentMessages.length === 6);
  add("evaluation endpoint is enabled outside production", isContextualOrderUnderstandingEvaluationEnabled("test"));
  add("evaluation endpoint is blocked in production", !isContextualOrderUnderstandingEvaluationEnabled("production"));

  const firstAddress = getValidatedCandidates({ message: "حي السلام", collected: { fullName: "عمر", phone: "0612345678", city: "مراكش" } });
  const nextAddress = getValidatedCandidates({ message: "زنقة 8", collected: { fullName: "عمر", phone: "0612345678", city: "مراكش", address: "حي السلام" } });
  add("partial address first part is collected", firstAddress.valid.some((candidate) => candidate.fieldKey === "address"));
  add("partial address next part appends", nextAddress.valid.some((candidate) => candidate.fieldKey === "address" && candidate.operation === "APPEND"));
  const addressCorrection = getValidatedCandidates({ message: "لا، العنوان الصحيح هو حي الرياض زنقة 4", collected: { address: "حي السلام" } });
  add("address correction replaces instead of appending", addressCorrection.valid.some((candidate) => candidate.fieldKey === "address" && candidate.operation === "REPLACE"));

  const multi = getValidatedCandidates({ message: "عمر 0612345678 مراكش حي السلام" });
  add("multi-field extracts name", multi.valid.some((candidate) => candidate.fieldKey === "fullName" && candidate.value === "عمر"));
  add("multi-field extracts phone", multi.valid.some((candidate) => candidate.fieldKey === "phone" && candidate.value === "0612345678"));
  add("multi-field extracts city structurally", multi.valid.some((candidate) => candidate.fieldKey === "city" && candidate.value === "مراكش"));
  add("multi-field extracts address structurally", multi.valid.some((candidate) => candidate.fieldKey === "address" && candidate.value === "حي السلام"));

  const namePhoneCity = getValidatedCandidates({ message: "محمد 0612345678 مراكش" });
  add("name phone and locality extracts city without address marker", namePhoneCity.valid.some((candidate) => candidate.fieldKey === "city" && candidate.value === "مراكش"));
  add("locality after phone is not also stored as address", !namePhoneCity.valid.some((candidate) => candidate.fieldKey === "address"));

  const quantity = getValidatedCandidates({ message: "واحدة" });
  add("quantity word fills quantity", quantity.valid.some((candidate) => candidate.fieldKey === "quantity" && candidate.value === 1));
  add("quantity word never fills name", !quantity.valid.some((candidate) => candidate.fieldKey === "fullName"));

  const sideQuestion = await understandContextualOrderMessage({
    customerId: "contextual-side-question",
    message: "واش التوصيل مجاني؟",
    productContext,
    session: createSession(),
    fields: baseFields,
  });
  add("side delivery question preserves order collection", sideQuestion.sideQuestion && sideQuestion.awaitedFieldKey === "fullName");

  const correctedCity = getValidatedCandidates({ message: "غلط المدينة هي الدار البيضاء", collected: { city: "مراكش" } });
  add("city correction is replace", correctedCity.valid.some((candidate) => candidate.fieldKey === "city" && candidate.operation === "REPLACE"));

  const unavailableColor = getValidatedCandidates({ message: "color:أصفر" });
  add("unavailable configured enum is rejected", !unavailableColor.valid.some((candidate) => candidate.fieldKey === "color"));

  const customField: RequiredOrderField = { key: "capacity", label: "السعة", required: true, enabled: true, source: "productOption", askOrder: 1, captureMode: "CONFIGURED_ENUM", options: ["128GB", "256GB"] };
  const custom = getValidatedCandidates({ message: "capacity:256GB", fields: [customField] });
  add("dynamic custom configured field is collected", custom.valid.some((candidate) => candidate.fieldKey === "capacity" && candidate.value === "256GB"));

  const noAiForAction = await understandContextualOrderMessage({
    customerId: "contextual-safe-action",
    message: "نعم",
    productContext,
    session: createSession(),
    fields: baseFields,
  });
  add("low-signal action keeps deterministic safety", !noAiForAction.aiFallbackUsed && noAiForAction.candidates.length === 0);

  const unclearSession = createSession({ fullName: "عمر", phone: "0612345678", address: "حي السلام", quantity: 1, color: "أسود" });
  const beforeUnclearState = JSON.stringify(unclearSession.orderState);
  const unclearDecision = await understandContextualOrderMessage({
    customerId: "contextual-unclear",
    message: "مكان غير واضح؟",
    productContext,
    session: unclearSession,
    fields: baseFields,
  });
  add(
    "unclear awaited value requests deterministic clarification without state mutation",
    !unclearDecision.aiFallbackUsed &&
      unclearDecision.needsClarification &&
      unclearDecision.candidates.length === 0 &&
      JSON.stringify(unclearSession.orderState) === beforeUnclearState,
  );

  const newOrderOnly = await understandContextualOrderMessage({
    customerId: "contextual-new-order-only",
    message: "بغيت ندير طلب",
    productContext,
    session: createSession(),
    fields: baseFields,
  });
  add("new-order command is consumed without field candidates", newOrderOnly.disposition === "NEW_ORDER" && newOrderOnly.candidates.length === 0 && !newOrderOnly.aiFallbackUsed);

  const naturalNewOrder = await understandContextualOrderMessage({
    customerId: "contextual-natural-order",
    message: "بغيت نكوموندي",
    productContext,
    session: createSession(),
    fields: baseFields,
  });
  add("natural order command never contaminates fields", naturalNewOrder.disposition === "NEW_ORDER" && naturalNewOrder.candidates.length === 0);

  const newOrderWithCity = await understandContextualOrderMessage({
    customerId: "contextual-new-order-city",
    message: "بغيت ندير طلب فمراكش",
    productContext,
    session: createSession(),
    fields: baseFields,
  });
  add("new order safely extracts city from residual text", newOrderWithCity.disposition === "NEW_ORDER" && newOrderWithCity.residualExtractionUsed && newOrderWithCity.candidates.some((candidate) => candidate.fieldKey === "city" && candidate.value === "مراكش") && !newOrderWithCity.candidates.some((candidate) => candidate.fieldKey === "fullName"));

  const newOrderWithIdentity = await understandContextualOrderMessage({
    customerId: "contextual-new-order-identity",
    message: "بغيت ندير طلب، سميتي عمر ورقمي 0612345678",
    productContext,
    session: createSession(),
    fields: baseFields,
  });
  add("new order residual extracts explicit name", newOrderWithIdentity.candidates.some((candidate) => candidate.fieldKey === "fullName" && candidate.value === "عمر"));
  add("new order residual extracts explicit phone", newOrderWithIdentity.candidates.some((candidate) => candidate.fieldKey === "phone" && candidate.value === "0612345678"));

  for (const [language, message] of [
    ["darija", "وش التوصيل مجاني"],
    ["arabizi", "wach livraison gratuite"],
    ["arabic", "هل التوصيل مجاني"],
    ["french", "la livraison est gratuite ?"],
  ]) {
    const decision = await understandContextualOrderMessage({
      customerId: `contextual-delivery-${language}`,
      message,
      productContext,
      session: createSession(),
      fields: baseFields,
    });
    add(`${language} delivery interruption produces no candidates`, decision.disposition === "DELIVERY_QUESTION" && decision.sideQuestion && decision.candidates.length === 0 && !decision.aiFallbackUsed);
  }

  const greetingDecision = await understandContextualOrderMessage({
    customerId: "contextual-greeting",
    message: "سلام",
    productContext,
    session: createSession(),
    fields: baseFields,
  });
  add("greeting during collection cannot mutate fields", greetingDecision.disposition === "GREETING" && greetingDecision.candidates.length === 0);

  const emptyMutationDraft = { fullName: "عبد الرحمان العلوي" };
  const emptyMutation = applyUnderstandingDecision({
    activeDraft: emptyMutationDraft,
    candidates: [],
    disposition: "DELIVERY_QUESTION",
    orderCycleId: "cycle-empty-mutation",
  });
  add("empty accepted candidate decision changes zero fields", emptyMutation.changedFieldKeys.length === 0 && JSON.stringify(emptyMutation.collected) === JSON.stringify(emptyMutationDraft));

  const commandWhileCity = await understandContextualOrderMessage({
    customerId: "contextual-command-city",
    message: "طلب جديد",
    productContext,
    session: createSession({ fullName: "عمر", phone: "0612345678" }),
    fields: baseFields,
  });
  add("new-order command is never stored as awaited city", commandWhileCity.disposition === "NEW_ORDER" && !commandWhileCity.candidates.some((candidate) => candidate.fieldKey === "city"));

  const deliveryWhileName = await understandContextualOrderMessage({
    customerId: "contextual-question-name",
    message: "وش التوصيل مجاني",
    productContext,
    session: createSession(),
    fields: baseFields,
  });
  add("delivery question is never stored as full name", !deliveryWhileName.candidates.some((candidate) => candidate.fieldKey === "fullName"));

  for (const name of [
    "عمر",
    "أسامة العزري",
    "فاطمة الزهراء",
    "Oussama",
    "Youssef El Amrani",
  ]) {
    const { valid } = getValidatedCandidates({ message: name });
    add(`contextual name accepts ${name}`, valid.some((candidate) => candidate.fieldKey === "fullName" && candidate.value === name));
  }

  for (const locality of [
    "مراكش",
    "دار بوعزة",
    "دوار النخيل الجديدة",
    "منطقة الأمل الشرقية",
  ]) {
    const { valid } = getValidatedCandidates({
      message: locality,
      collected: { fullName: "عمر", phone: "0612345678", address: "حي السلام", quantity: 1, color: "أسود" },
    });
    add(`awaited location accepts unseen value ${locality}`, valid.some((candidate) => candidate.fieldKey === "city" && candidate.value === locality));
  }

  for (const address of [
    "حي السلام زنقة 4 رقم 12",
    "قرب مسجد النور",
    "résidence Al Amal appartement 6",
  ]) {
    const { valid } = getValidatedCandidates({
      message: address,
      collected: { fullName: "عمر", phone: "0612345678", city: "مراكش" },
    });
    add(`awaited address accepts ${address}`, valid.some((candidate) => candidate.fieldKey === "address" && candidate.value === address));
  }

  const semanticNameField: RequiredOrderField = {
    key: "customerName",
    label: "اسم المستلم",
    required: true,
    enabled: true,
    source: "customerField",
    askOrder: 1,
    semanticType: "PERSON_NAME",
  };
  const semanticName = getValidatedCandidates({
    message: "Oussama El Amrani",
    fields: [semanticNameField],
  });
  add("custom PERSON_NAME field is captured deterministically", semanticName.valid.some((candidate) => candidate.fieldKey === "customerName" && candidate.value === "Oussama El Amrani"));

  const semanticPhoneField: RequiredOrderField = {
    key: "contactNumber",
    label: "رقم التواصل",
    required: true,
    enabled: true,
    source: "customerField",
    askOrder: 1,
    semanticType: "PHONE",
  };
  const semanticPhone = getValidatedCandidates({ message: "0612345678", fields: [semanticPhoneField] });
  add("custom PHONE field is captured deterministically", semanticPhone.valid.some((candidate) => candidate.fieldKey === "contactNumber" && candidate.value === "0612345678"));

  const semanticNumericField: RequiredOrderField = {
    key: "packCount",
    label: "عدد العلب",
    required: true,
    enabled: true,
    source: "customerField",
    askOrder: 1,
    semanticType: "NUMERIC",
    minValue: 1,
    maxValue: 20,
  };
  const semanticNumeric = getValidatedCandidates({ message: "3", fields: [semanticNumericField] });
  add("custom NUMERIC field is captured deterministically", semanticNumeric.valid.some((candidate) => candidate.fieldKey === "packCount" && candidate.value === 3));

  const modelField: RequiredOrderField = {
    key: "model",
    label: "الموديل",
    required: true,
    enabled: true,
    source: "productOption",
    askOrder: 1,
    captureMode: "CONFIGURED_ENUM",
    options: ["Classic", "Premium"],
  };
  const modelSelection = getValidatedCandidates({ message: "model:Premium", fields: [modelField] });
  add("configured model option is captured deterministically", modelSelection.valid.some((candidate) => candidate.fieldKey === "model" && candidate.value === "Premium"));
  const modelCorrection = getValidatedCandidates({ message: "بدل الموديل Premium", fields: [modelField], collected: { model: "Classic" } });
  add("configured model correction is deterministic", modelCorrection.valid.some((candidate) => candidate.fieldKey === "model" && candidate.value === "Premium" && candidate.operation === "REPLACE"));

  const customNoteField: RequiredOrderField = {
    key: "giftNote",
    label: "ملاحظة الهدية",
    required: true,
    enabled: true,
    source: "customerField",
    askOrder: 1,
    captureMode: "OPEN_TEXT",
  };
  const customCorrection = getValidatedCandidates({
    message: "بدل ملاحظة الهدية عيط ليا قبل التوصيل",
    fields: [customNoteField],
    collected: { giftNote: "المعلومة القديمة" },
  });
  add("custom open-text correction is deterministic", customCorrection.valid.some((candidate) => candidate.fieldKey === "giftNote" && candidate.value === "عيط ليا قبل التوصيل" && candidate.operation === "REPLACE"));

  const completeValidDraft = {
    fullName: "عبد الرحمان العلوي",
    phone: "0612345678",
    city: "دوار الزيتون الغربي",
    address: "حي السلام رقم 8",
    quantity: 1,
    color: "أسود",
  };
  const validIntegrity = validateOrderDraftIntegrity({
    collected: completeValidDraft,
    productContext,
    fields: baseFields,
  });
  add("integrity gate accepts valid open-world city", validIntegrity.passed && validIntegrity.collected.city === "دوار الزيتون الغربي");

  const corruptedIntegrity = validateOrderDraftIntegrity({
    collected: {
      ...completeValidDraft,
      fullName: "وش التوصيل مجاني",
      city: "بغيت ندير طلب",
    },
    productContext,
    fields: baseFields,
  });
  add("integrity gate removes corrupted name and city", !corruptedIntegrity.passed && corruptedIntegrity.invalidFieldKeys.includes("fullName") && corruptedIntegrity.invalidFieldKeys.includes("city") && !corruptedIntegrity.collected.fullName && !corruptedIntegrity.collected.city);

  const incompatibleProvenance = validateOrderDraftIntegrity({
    collected: completeValidDraft,
    productContext,
    fields: baseFields,
    understanding: {
      fields: {},
      provenance: {
        city: {
          source: "DETERMINISTIC_CONTEXTUAL",
          confidence: 0.9,
          operation: "SET",
          sourceMessageDisposition: "DELIVERY_QUESTION",
          orderCycleId: "cycle-incompatible",
          acceptedAt: new Date().toISOString(),
        },
      },
    },
  });
  add("integrity gate rejects incompatible field provenance", !incompatibleProvenance.passed && incompatibleProvenance.invalidFieldKeys.includes("city"));
  const deterministicDiagnostics = getOrderUnderstandingDiagnostics();
  add(
    "order understanding diagnostics enforce zero AI participation",
    deterministicDiagnostics.deterministicOnly &&
      deterministicDiagnostics.ai === 0 &&
      deterministicDiagnostics.hybrid === 0 &&
      deterministicDiagnostics.aiFailures === 0,
  );

  const activeOrderRouterProbe = await analyzeAIIntentWithMeta({
    message: "قيمة حرة ما واضحةش",
    productContext,
    orderState: createSession({ fullName: "عمر" }).orderState,
  });
  add(
    "smart router never calls AI while an order field is awaited",
    !activeOrderRouterProbe.meta.usedAI &&
      !activeOrderRouterProbe.meta.timedOut &&
      activeOrderRouterProbe.intentAnalysis.entities.city === null,
  );

  const directDisposition = classifyOrderMessageDisposition("وش التوصيل مجاني");
  add("message firewall consumes delivery questions", directDisposition.disposition === "DELIVERY_QUESTION" && directDisposition.consumed && !directDisposition.extractionText);

  const passed = results.filter((result) => result.passed).length;
  return {
    summary: { total: results.length, passed, failed: results.length - passed, passedAll: passed === results.length },
    results,
  };
}
