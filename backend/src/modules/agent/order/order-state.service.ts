import { randomUUID } from "node:crypto";
import type { ConversationSession, OrderEntities } from "../agent-brain.types";
import type { RequiredOrderField } from "../config/required-fields.types";
import { requiredFieldsService } from "../config/required-fields.service";
import { fastAnalyzeCustomerMessage } from "../fast-intent-analyzer.service";
import type { ProductContext } from "../product-context.types";
import {
  isValidOrderField,
  recordInvalidCandidateRejected,
  recordInvalidExistingCleared,
  recordOrderConfirmationBlockedInvalidFields,
  validateOrderEntities,
} from "./order-field-validator.service";
import {
  getConversationSession,
  saveConversationSession,
  updateConversationOrderState,
} from "../session/conversation-session.service";
import {
  renderOrderProgressReply,
} from "./order-response.builder";
import type {
  AgentReplyUiHint,
  OrderConfirmationPresentation,
} from "../reply/reply-renderer.types";
import {
  getConfirmedOrderByCustomerId,
  saveConfirmedOrder,
} from "./confirmed-order-store.service";

type OrderField = keyof OrderEntities;
type EditableOrderField = OrderField | "delivery_info";

type ProcessOrderTurnInput = {
  customerId: string;
  customerPhone?: string;
  sellerId?: string;
  productId?: string;
  message: string;
  productContext: ProductContext;
  analysis?: {
    intent?: string;
    entities?: OrderEntities;
  };
  requiredFields?: RequiredOrderField[];
};

type ProcessOrderTurnResult = {
  handled: boolean;
  reply?: string;
  replyUi?: AgentReplyUiHint;
  replyPresentation?: OrderConfirmationPresentation;
  orderJustConfirmed?: boolean;
  confirmedOrderId?: string;
  publicOrderCode?: string;
  isComplete: boolean;
  missingFields: string[];
};

const defaultRequiredOrderFields: RequiredOrderField[] = [
  {
    key: "fullName",
    label: "الاسم الكامل",
    required: true,
    enabled: true,
    source: "customerField",
    askOrder: 1,
  },
  {
    key: "phone",
    label: "رقم الهاتف",
    required: true,
    enabled: true,
    source: "customerField",
    askOrder: 2,
  },
  {
    key: "city",
    label: "المدينة",
    required: true,
    enabled: true,
    source: "customerField",
    askOrder: 3,
  },
  {
    key: "address",
    label: "العنوان",
    required: true,
    enabled: true,
    source: "customerField",
    askOrder: 4,
  },
];

const fieldLabelMap = new Map<string, OrderField>([
  ["الاسم الكامل", "fullName"],
  ["الإسم الكامل", "fullName"],
  ["الاسم", "fullName"],
  ["رقم الهاتف", "phone"],
  ["الهاتف", "phone"],
  ["المدينة", "city"],
  ["العنوان", "address"],
  ["اللون", "color"],
  ["المقاس", "size"],
  ["الكمية", "quantity"],
  ["productName", "productName"],
  ["variant", "variant"],
]);
const knownOrderFieldKeys = new Set<string>([
  "fullName",
  "phone",
  "city",
  "address",
  "productName",
  "variant",
  "color",
  "size",
  "quantity",
  "notes",
]);

const cityAliases: Array<{ city: string; aliases: string[] }> = [
  { city: "مراكش", aliases: ["مراكش", "marrakech", "marrakesh"] },
  {
    city: "الدار البيضاء",
    aliases: [
      "كازا",
      "casa",
      "casablanca",
      "الدار البيضاء",
      "الدارالبيضاء",
      "دار البيضاء",
      "دارالبيضاء",
    ],
  },
  { city: "الرباط", aliases: ["الرباط", "rabat"] },
  { city: "فاس", aliases: ["فاس", "fes", "fès"] },
  { city: "طنجة", aliases: ["طنجة", "tanger", "tangier", "tanja"] },
];

const colorAliases: Array<{ color: string; aliases: string[] }> = [
  {
    color: "أسود",
    aliases: ["كحل", "كحلة", "أسود", "اسود", "k7el", "k7la", "kahla", "noir", "black"],
  },
  {
    color: "وردي",
    aliases: ["وردي", "الوردي", "werdi", "wardi", "rose", "lwerdi", "pink"],
  },
  {
    color: "أبيض",
    aliases: ["أبيض", "ابيض", "بيضاء", "byda", "bayda", "white", "blanc"],
  },
  {
    color: "أحمر",
    aliases: ["أحمر", "احمر", "حمر", "حمرة", "7mra", "hamra", "red", "rouge"],
  },
  {
    color: "أصفر",
    aliases: ["أصفر", "اصفر", "صفر", "sfar", "yellow", "jaune"],
  },
];

const confirmationMessages = [
  "order:confirm",
  "نعم",
  "ايه",
  "اه",
  "أوكي",
  "اوكي",
  "واخا",
  "اكد",
  "أكد",
  "ناكد",
  "تأكيد",
  "تاكيد",
  "أكد الطلب",
  "اكد الطلب",
  "تأكيد الطلب",
  "تاكيد الطلب",
  "صافي",
  "توكل",
  "توكل على الله",
  "تمام",
  "yes",
  "confirm",
  "ok",
];

const negativeCorrectionMessages = [
  "order:edit",
  "تعديل",
  "تعديل الطلب",
  "بغيت نعدل",
  "بغيت نبدل",
  "نبدل",
  "edit",
  "modifier",
  "لا",
  "لا باقي",
  "no",
  "non",
];
const cancellationMessages = [
  "الغاء الطلب",
  "الغاء",
  "إلغاء الطلب",
  "إلغاء",
  "لا شكرا الغي الطلب",
  "لا شكراً الغي الطلب",
  "cancel order",
  "cancel",
];

const correctionKeywords = [
  "بغيت نبدل",
  "باغي نبدل",
  "باغية نبدل",
  "نبدل",
  "غلط",
  "بدل",
  "غير",
  "صحح",
];

const correctionClarificationReply =
  "شنو المعلومة اللي بغيتي تبدل؟ المقاس، اللون، الكمية، الاسم، الهاتف، المدينة ولا العنوان؟";
const alreadyConfirmedReply =
  "الطلب ديالك راه تأكد من قبل. غادي نتواصلو معاك قريباً.";
const orderCancelledReply =
  "تمام، ما غاديش نأكد الطلب. إلى بغيتي تبدل شي حاجة ولا ترجع تطلب، أنا هنا.";

const newOrderMessages = [
  "order:new",
  "بغيت نطلب واحد آخر",
  "بغيت نطلب واحد اخر",
  "بغيت طلب جديد",
  "نطلب مرة أخرى",
  "نطلب مرة اخرى",
  "طلب جديد",
  "واحد آخر",
  "واحد اخر",
  "another order",
  "new order",
];

const thanksMessages = [
  "شكرا",
  "شكراً",
  "chokran",
  "shokran",
  "merci",
  "thanks",
  "thank you",
];

const blessingThanksMessages = [
  "الله يعطيك الصحة",
  "lah y3tik saha",
  "lah yatik saha",
];

const editOptions: Array<{
  field: EditableOrderField;
  id: string;
  label: string;
}> = [
  { field: "size", id: "edit:size", label: "المقاس" },
  { field: "color", id: "edit:color", label: "اللون" },
  { field: "quantity", id: "edit:quantity", label: "الكمية" },
  { field: "fullName", id: "edit:fullName", label: "الاسم" },
  { field: "phone", id: "edit:phone", label: "الهاتف" },
  { field: "city", id: "edit:city", label: "المدينة" },
  { field: "address", id: "edit:address", label: "العنوان" },
  {
    field: "delivery_info",
    id: "edit:delivery_info",
    label: "معلومات التوصيل كاملة",
  },
];

function buildConfirmedReply(publicOrderCode: string): string {
  return [
    "تسجل الطلب ديالك بنجاح ✅",
    "",
    `رقم الطلب: ${publicOrderCode}`,
    "",
    "غادي يتواصل معاك فريق المتجر لتأكيد التوصيل.",
  ].join("\n");
}

function buildAlreadyConfirmedReply(publicOrderCode?: string): string {
  return [
    "الطلب ديالك تأكد من قبل ✅",
    ...(publicOrderCode ? [`رقم الطلب: ${publicOrderCode}`] : []),
  ].join("\n");
}

function buildConfirmedEditBlockedReply(publicOrderCode?: string): string {
  return [
    "الطلب ديالك تأكد من قبل ✅",
    ...(publicOrderCode ? [`رقم الطلب: ${publicOrderCode}`] : []),
    "إلى بغيتي تبدل شي معلومة، تواصل مع المتجر قبل الشحن.",
  ].join("\n");
}

function isNewOrderIntent(message: string): boolean {
  const normalizedMessage = normalizeText(message);

  return isExactMessage(normalizedMessage, newOrderMessages);
}

function isDuplicateConfirmationIntent(message: string): boolean {
  return isExactMessage(normalizeText(message), confirmationMessages);
}

function isThanksMessage(message: string): boolean {
  return isExactMessage(normalizeText(message), thanksMessages);
}

function isBlessingThanksMessage(message: string): boolean {
  return isExactMessage(normalizeText(message), blessingThanksMessages);
}

function stripOrderStartIntro(text: string): string {
  return text
    .replace(/^تمام\s*✅\s*/u, "")
    .replace(/^نبدأو الطلب ديالك\.\s*/u, "")
    .trim();
}

function buildEditChoiceReply(prefix = "شنو بغيتي تبدل في الطلب؟"): {
  text: string;
  ui: AgentReplyUiHint;
} {
  return {
    text: prefix,
    ui: {
      kind: "list",
      purpose: "confirmation",
      title: "تعديل الطلب",
      body: prefix,
      options: editOptions.map((option) => ({
        id: option.id,
        label: option.label,
        value: option.label,
      })),
    },
  };
}

function getEditFieldFromMessage(message: string): EditableOrderField | undefined {
  const normalizedMessage = normalizeText(message);
  const directMatch = editOptions.find(
    (option) => normalizeText(option.id) === normalizedMessage,
  );

  if (directMatch) {
    return directMatch.field;
  }

  if (includesAny(normalizedMessage, ["معلومات التوصيل", "delivery_info"])) {
    return "delivery_info";
  }

  return editOptions.find((option) =>
    normalizedMessage === normalizeText(option.label),
  )?.field;
}

function buildEditFieldPrompt(
  field: EditableOrderField,
  requiredFields?: RequiredOrderField[],
): { text: string; ui?: AgentReplyUiHint } {
  const configuredField = requiredFields?.find(
    (candidate) => candidate.key === field,
  );

  if (field === "delivery_info") {
    return {
      text: "عافاك عطيني معلومات التوصيل من جديد:\nالاسم + الهاتف + المدينة + العنوان",
    };
  }

  if (field === "size" && configuredField?.options?.length) {
    const text = "اختار المقاس الجديد.";

    return {
      text,
      ui: {
        kind: "list",
        purpose: "field_options",
        title: "اختار المقاس",
        body: text,
        options: configuredField.options.map((option) => ({
          id: `size:${option}`,
          label: option,
          value: option,
        })),
      },
    };
  }

  if (field === "color" && configuredField?.options?.length) {
    const text = "اختار اللون الجديد.";

    return {
      text,
      ui: {
        kind: configuredField.options.length <= 3 ? "buttons" : "list",
        purpose: "field_options",
        title: "اختار اللون",
        body: text,
        options: configuredField.options.map((option) => ({
          id: `color:${option}`,
          label: option,
          value: option,
        })),
      },
    };
  }

  const prompts: Record<string, string> = {
    quantity: "شحال من وحدة بغيتي؟",
    fullName: "شنو الاسم الجديد؟",
    phone: "شنو رقم الهاتف الجديد؟",
    city: "شنو المدينة الجديدة؟",
    address: "شنو العنوان الجديد؟",
  };

  return {
    text: prompts[field] || `عافاك عطيني ${configuredField?.label || field}.`,
  };
}

function buildCorrectionClarificationReply(
  requiredFields?: RequiredOrderField[],
): string {
  const labels = (requiredFields || [])
    .map((field) => field.label)
    .filter(Boolean);

  if (!labels.length) {
    return correctionClarificationReply;
  }

  return `شنو المعلومة اللي بغيتي تبدل؟ ${formatNaturalList(labels)}؟`;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[؟?،,.;:!]/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(normalizedText: string, terms: string[]): boolean {
  return terms.some((term) => normalizedText.includes(normalizeText(term)));
}

function normalizeComparable(text: string): string {
  return normalizeText(text).replace(/^ال/, "");
}

function formatNaturalList(items: string[]): string {
  const cleanItems = items.map((item) => item.trim()).filter(Boolean);

  if (cleanItems.length <= 1) {
    return cleanItems.join("");
  }

  return `${cleanItems.slice(0, -1).join("، ")} و${
    cleanItems[cleanItems.length - 1]
  }`;
}

function isExactMessage(normalizedText: string, messages: string[]): boolean {
  return messages.some((message) => normalizedText === normalizeText(message));
}

function hasValue(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0;
  }

  return typeof value === "string" ? Boolean(value.trim()) : Boolean(value);
}

function cleanEntities(entities: OrderEntities): Partial<OrderEntities> {
  return Object.fromEntries(
    Object.entries(entities).filter(([, value]) => hasValue(value)),
  ) as Partial<OrderEntities>;
}

function getAvailableColors(productContext: ProductContext): string[] {
  return productContext.availableColors?.map((color) => color.trim()).filter(Boolean) || [];
}

function getAvailableSizes(productContext: ProductContext): string[] {
  return productContext.availableSizes?.map((size) => size.trim()).filter(Boolean) || [];
}

function isAvailableColorValue(
  color: string,
  productContext: ProductContext,
): boolean {
  const availableColors = getAvailableColors(productContext);

  if (!availableColors.length) {
    return true;
  }

  return availableColors.some(
    (availableColor) =>
      normalizeComparable(availableColor) === normalizeComparable(color),
  );
}

function isAvailableSizeValue(
  size: string,
  productContext: ProductContext,
): boolean {
  const availableSizes = getAvailableSizes(productContext);

  if (!availableSizes.length) {
    return true;
  }

  return availableSizes.some(
    (availableSize) =>
      normalizeComparable(availableSize) === normalizeComparable(size),
  );
}

function buildUnavailableColorReply(
  color: string,
  productContext: ProductContext,
): string {
  const availableColors = getAvailableColors(productContext);
  const colorText = color.startsWith("ال") ? color : `ال${color}`;

  if (!availableColors.length) {
    return `اللون ${colorText} ما نقدرش نأكدو دابا. نقدر نراجع الألوان المتوفرة من عند صاحب المتجر.`;
  }

  return `اللون ${colorText} ما متوفرش حالياً. الألوان المتوفرة هي: ${formatNaturalList(
    availableColors,
  )}. شنو اللون اللي بغيتي؟`;
}

function buildUnavailableSizeReply(
  size: string,
  productContext: ProductContext,
): string {
  const availableSizes = getAvailableSizes(productContext);

  if (!availableSizes.length) {
    return `مقاس ${size} ما نقدرش نأكدو دابا. نقدر نراجع المقاسات المتوفرة من عند صاحب المتجر.`;
  }

  return `مقاس ${size} ما متوفرش حالياً. المقاسات المتوفرة هي: ${formatNaturalList(
    availableSizes,
  )}.`;
}

function getOptionField(
  key: string,
  requiredFields?: RequiredOrderField[],
): RequiredOrderField | undefined {
  return requiredFields?.find(
    (field) => field.key === key && field.source === "productOption",
  );
}

function matchConfiguredOption(
  value: unknown,
  options: string[] | undefined,
): string | undefined {
  if (typeof value !== "string" || !options?.length) {
    return undefined;
  }

  const comparableValue = normalizeComparable(value);

  return options.find(
    (option) => normalizeComparable(option) === comparableValue,
  );
}

function findConfiguredOption(
  message: string,
  options: string[] | undefined,
): string | undefined {
  if (!options?.length) {
    return undefined;
  }

  const normalizedMessage = normalizeText(message);

  return options.find((option) => {
    const normalizedOption = normalizeText(option);

    return (
      normalizedMessage === normalizedOption ||
      normalizedMessage.includes(normalizedOption)
    );
  });
}

function buildUnavailableOptionReply(
  field: RequiredOrderField,
  value: unknown,
): string {
  const valueText = typeof value === "string" ? value.trim() : String(value);
  const optionsText = formatNaturalList(field.options || []);

  if (field.key === "color") {
    const colorText = valueText.startsWith("ال") ? valueText : `ال${valueText}`;

    return `اللون ${colorText} ما متوفرش حالياً. الألوان المتوفرة هي: ${optionsText}. شنو اللون اللي بغيتي؟`;
  }

  if (field.key === "size") {
    return `مقاس ${valueText} ما متوفرش حالياً. المقاسات المتوفرة هي: ${optionsText}.`;
  }

  return `${field.label} ${valueText} ما متوفرش حالياً. الاختيارات المتوفرة هي: ${optionsText}.`;
}

function getQuantityField(
  requiredFields?: RequiredOrderField[],
): RequiredOrderField | undefined {
  return requiredFields?.find((field) => field.key === "quantity");
}

function isQuantityWithinConfiguredRange(
  value: unknown,
  field?: RequiredOrderField,
): boolean {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return false;
  }

  if (typeof field?.minValue === "number" && value < field.minValue) {
    return false;
  }

  if (typeof field?.maxValue === "number" && value > field.maxValue) {
    return false;
  }

  return true;
}

function buildInvalidQuantityReply(
  value: unknown,
  field?: RequiredOrderField,
): string {
  const minQuantity = typeof field?.minValue === "number" ? field.minValue : 1;
  const maxQuantity =
    typeof field?.maxValue === "number" ? field.maxValue : undefined;

  if (maxQuantity === 1 && minQuantity <= 1) {
    return "حالياً نقدر نسجل لك كمية 1 فقط.\nعافاك كتب 1 باش نكملو الطلب.";
  }

  if (typeof maxQuantity === "number") {
    return `الكمية المتوفرة حالياً حتى ${maxQuantity}.\nعافاك اختار كمية بين ${minQuantity} و ${maxQuantity}.`;
  }

  if (typeof value === "number" && value <= 0) {
    return "عافاك اختار كمية صحيحة ابتداءً من 1.";
  }

  return "عافاك كتب الكمية برقم واضح باش نكملو الطلب.";
}

function validateIncomingOrderEntities(
  entities: Partial<OrderEntities>,
  productContext: ProductContext,
  requiredFields?: RequiredOrderField[],
): { entities: Partial<OrderEntities>; reply?: string } {
  const fieldValidation = validateOrderEntities(entities, productContext);
  const quantityField = getQuantityField(requiredFields);

  for (const invalidField of fieldValidation.invalidFields) {
    const field = invalidField as keyof OrderEntities;

    recordInvalidCandidateRejected({
      field,
      value: entities[field],
    });
  }

  const validEntities = { ...fieldValidation.validEntities } as Record<
    string,
    unknown
  >;

  if (
    hasValue(entities.quantity) &&
    !isQuantityWithinConfiguredRange(entities.quantity, quantityField)
  ) {
    recordInvalidCandidateRejected({
      field: "quantity",
      value: entities.quantity,
      reason: "invalid_or_out_of_range_quantity",
    });

    delete validEntities.quantity;

    return {
      entities: validEntities as Partial<OrderEntities>,
      reply: buildInvalidQuantityReply(entities.quantity, quantityField),
    };
  }

  for (const [field, value] of Object.entries(entities)) {
    const optionField = getOptionField(field, requiredFields);

    if (!optionField?.options?.length || !hasValue(value)) {
      continue;
    }

    const matchedOption = matchConfiguredOption(value, optionField.options);

    if (!matchedOption) {
      recordInvalidCandidateRejected({
        field: field as keyof OrderEntities,
        value: value as OrderEntities[keyof OrderEntities],
        reason: "unavailable_configured_option",
      });

      delete validEntities[field];

      return {
        entities: validEntities as Partial<OrderEntities>,
        reply: buildUnavailableOptionReply(optionField, value),
      };
    }

    validEntities[field] = matchedOption;
  }

  const colorOptionField = getOptionField("color", requiredFields);
  const sizeOptionField = getOptionField("size", requiredFields);

  if (
    typeof validEntities.color === "string" &&
    validEntities.color.trim() &&
    !colorOptionField &&
    !isAvailableColorValue(validEntities.color, productContext)
  ) {
    return {
      entities: {
        ...validEntities,
        color: undefined,
      },
      reply: buildUnavailableColorReply(validEntities.color, productContext),
    };
  }

  if (
    typeof validEntities.size === "string" &&
    validEntities.size.trim() &&
    !sizeOptionField &&
    !isAvailableSizeValue(validEntities.size, productContext)
  ) {
    return {
      entities: {
        ...validEntities,
        size: undefined,
      },
      reply: buildUnavailableSizeReply(validEntities.size, productContext),
    };
  }

  return { entities: validEntities as Partial<OrderEntities> };
}

function getActiveRequiredFields(
  productContext: ProductContext,
  requiredFields?: RequiredOrderField[],
): RequiredOrderField[] {
  if (requiredFields?.length) {
    return requiredFields.filter((field) => field.required && field.enabled);
  }

  const mappedFields = (productContext.requiredOrderFields || [])
    .map((field, index): RequiredOrderField | undefined => {
      const key = fieldLabelMap.get(field);

      if (!key) {
        return undefined;
      }

      return {
        key,
        label: field,
        required: true,
        enabled: true,
        source: "customerField",
        askOrder: index + 1,
      };
    })
    .filter((field): field is RequiredOrderField => Boolean(field));

  return mappedFields.length ? mappedFields : defaultRequiredOrderFields;
}

function isValidDynamicOrderField(
  field: RequiredOrderField,
  value: unknown,
  productContext: ProductContext,
): boolean {
  if (!hasValue(value)) {
    return false;
  }

  if (field.source === "productOption" && field.options?.length) {
    return Boolean(matchConfiguredOption(value, field.options));
  }

  if (knownOrderFieldKeys.has(field.key)) {
    return isValidOrderField(
      field.key as keyof OrderEntities,
      value as OrderEntities[keyof OrderEntities],
      productContext,
    );
  }

  return true;
}

function computeMissingFields(
  collected: OrderEntities,
  productContext: ProductContext,
  requiredFields?: RequiredOrderField[],
): string[] {
  const activeRequiredFields = getActiveRequiredFields(productContext, requiredFields);
  const collectedRecord = collected as Record<string, unknown>;

  return requiredFieldsService
    .getMissingRequiredFields({
      requiredFields: activeRequiredFields,
      collected: collectedRecord,
    })
    .concat(
      activeRequiredFields.filter(
        (field) =>
          hasValue(collectedRecord[field.key]) &&
          !isValidDynamicOrderField(
            field,
            collectedRecord[field.key],
            productContext,
          ),
      ),
    )
    .map((field) => field.key)
    .filter((field, index, fields) => fields.indexOf(field) === index);
}

async function sanitizeStoredOrderState(
  session: ConversationSession,
  productContext: ProductContext,
  requiredFields?: RequiredOrderField[],
): Promise<ConversationSession> {
  const collected: OrderEntities = { ...session.orderState.collected };
  let changed = false;

  if (session.orderState.confirmed) {
    return session;
  }

  const activeRequiredFields = getActiveRequiredFields(productContext, requiredFields);

  for (const [field, value] of Object.entries(collected) as Array<[
    keyof OrderEntities,
    OrderEntities[keyof OrderEntities],
  ]>) {
    if (!hasValue(value)) {
      continue;
    }

    const requiredField = activeRequiredFields.find(
      (candidate) => candidate.key === field,
    );
    const isValid = requiredField
      ? isValidDynamicOrderField(requiredField, value, productContext)
      : isValidOrderField(field, value, productContext);

    if (!isValid) {
      delete collected[field];
      changed = true;
      recordInvalidExistingCleared({
        field,
        value,
      });
    }
  }

  const colorOptionField = getOptionField("color", activeRequiredFields);
  const sizeOptionField = getOptionField("size", activeRequiredFields);
  const color = collected.color;

  if (
    typeof color === "string" &&
    color.trim() &&
    !colorOptionField &&
    !isAvailableColorValue(color, productContext)
  ) {
    delete collected.color;
    changed = true;
    recordInvalidExistingCleared({
      field: "color",
      value: color,
    });
  }

  const size = collected.size;

  if (
    typeof size === "string" &&
    size.trim() &&
    !sizeOptionField &&
    !isAvailableSizeValue(size, productContext)
  ) {
    delete collected.size;
    changed = true;
    recordInvalidExistingCleared({
      field: "size",
      value: size,
    });
  }

  if (!changed) {
    return session;
  }

  session.orderState = {
    ...session.orderState,
    collected,
    missingFields: computeMissingFields(
      collected,
      productContext,
      activeRequiredFields,
    ),
    isComplete: false,
    awaitingConfirmation: false,
    confirmed: false,
    lastUpdatedAt: new Date().toISOString(),
  };

  await saveConversationSession(session);

  return session;
}

function findPhone(message: string): string | undefined {
  const phoneMatch = message.match(/(?:\+212|0)[67]\d{8}\b/);
  const phone = phoneMatch?.[0];

  if (!phone) {
    return undefined;
  }

  return phone.startsWith("+212") ? `0${phone.slice(4)}` : phone;
}

function findCity(message: string): string | undefined {
  const normalizedMessage = normalizeText(message);

  return cityAliases.find((cityAlias) =>
    cityAlias.aliases.some((alias) =>
      normalizedMessage.includes(normalizeText(alias)) ||
      normalizedMessage.replace(/\s+/g, "").includes(
        normalizeText(alias).replace(/\s+/g, ""),
      ),
    ),
  )?.city;
}

function findColor(message: string): string | undefined {
  const normalizedMessage = normalizeText(message);
  const normalizedCompactMessage = normalizedMessage.replace(/\s+/g, "");
  const mentionsCasablanca =
    normalizedMessage.includes("الدار البيضاء") ||
    normalizedCompactMessage.includes("الدارالبيضاء") ||
    normalizedMessage.includes("دار البيضاء") ||
    normalizedCompactMessage.includes("دارالبيضاء") ||
    normalizedMessage.includes("كازا") ||
    /\bcasa\b|\bcasablanca\b/i.test(normalizedMessage);

  return colorAliases.find((colorAlias) =>
    colorAlias.aliases.some((alias) => {
      if (colorAlias.color === "أبيض" && mentionsCasablanca) {
        return false;
      }

      return normalizedMessage.includes(normalizeText(alias));
    }),
  )?.color;
}

function isKnownCityOnly(message: string): boolean {
  const normalizedMessage = normalizeText(message);

  return cityAliases.some((cityAlias) =>
    cityAlias.aliases.some((alias) => normalizedMessage === normalizeText(alias)),
  );
}

function isKnownColorOnly(message: string): boolean {
  const normalizedMessage = normalizeText(message);

  return colorAliases.some((colorAlias) =>
    colorAlias.aliases.some((alias) => normalizedMessage === normalizeText(alias)),
  );
}

function findSize(message: string): string | undefined {
  const selectedSizeMatch = message.trim().match(/^size:(3[6-9]|4[0-5])$/i);

  if (selectedSizeMatch?.[1]) {
    return selectedSizeMatch[1];
  }

  const labeledLetterSizeMatch = message.match(
    /(?:size|taille|مقاس|قياس)\s*(xxl|xl|xs|s|m|l)\b/i,
  );

  if (labeledLetterSizeMatch?.[1]) {
    return labeledLetterSizeMatch[1].toUpperCase();
  }

  const sizeMatch = message.match(/\b(3[6-9]|4[0-5])\b/i);

  return sizeMatch?.[1]?.toUpperCase();
}

function findQuantity(message: string): number | undefined {
  const normalizedMessage = normalizeText(message);
  const labeledQuantityMatch = normalizedMessage.match(
    /(?:الكمية|كمية|quantity|qte|qty|عدد)\s*(?:هو|هي|:)?\s*(?:ل)?([1-9]\d*)\b/i,
  );
  const standaloneNumberMatch = normalizedMessage.match(/^([1-9]\d*)$/);

  if (labeledQuantityMatch?.[1]) {
    return Number(labeledQuantityMatch[1]);
  }

  if (standaloneNumberMatch?.[1]) {
    return Number(standaloneNumberMatch[1]);
  }

  if (
    /(^|\s)1(\s|$)/.test(message) ||
    includesAny(normalizedMessage, [
      "wa7da",
      "wahda",
      "w7da",
      "wahed",
      "wahd",
      "واحدة",
      "وحدة",
      "واحد",
    ])
  ) {
    return 1;
  }

  if (
    /(^|\s)2(\s|$)/.test(message) ||
    includesAny(normalizedMessage, ["jouj", "jooj", "jوج", "جوج", "زوج"])
  ) {
    return 2;
  }

  return undefined;
}

function shouldCollectOptionalQuantity(message: string): boolean {
  const normalizedMessage = normalizeText(message);

  return (
    Boolean(findColor(message) || findSize(message) || isOrderStartMessage(message)) &&
    (/(^|\s)[1-9]\d*(\s|$)/.test(message) ||
      includesAny(normalizedMessage, [
        "wa7da",
        "wahda",
        "w7da",
        "wahed",
        "wahd",
        "واحدة",
        "وحدة",
        "واحد",
        "jouj",
        "jooj",
        "جوج",
        "زوج",
        "quantity",
        "qte",
        "qty",
        "كمية",
        "الكمية",
      ]))
  );
}

function stripAfterQuantityMarker(text: string): string {
  return text
    .replace(/(الكمية|كمية|quantity|qte|qty|عدد).*$/i, "")
    .trim();
}

function findAddress(message: string): string | undefined {
  const normalizedMessage = normalizeText(message);
  const labeledAddressMatch = normalizedMessage.match(
    /(العنوان|address|adresse)\s+(.+)/i,
  );

  if (labeledAddressMatch?.[2]) {
    const address = stripAfterQuantityMarker(labeledAddressMatch[2]);

    return looksLikeAddressText(address) ? address : undefined;
  }

  const addressMatch = normalizedMessage.match(/(حي|شارع|زنقة|رقم)\s+(.+)/);

  if (!addressMatch) {
    return undefined;
  }

  const address = stripAfterQuantityMarker(
    `${addressMatch[1]} ${addressMatch[2]}`,
  );

  return looksLikeAddressText(address) ? address : undefined;
}

function getPhoneTextFromMessage(message: string, phone: string): string | undefined {
  if (message.includes(phone)) {
    return phone;
  }

  return message.match(/(?:\+212|0)[67]\d{8}\b/)?.[0];
}

function looksLikeAddressText(text: string): boolean {
  const normalizedText = normalizeText(text);

  if (!normalizedText) {
    return false;
  }

  if (/^(حي|شارع|زنقة|رقم)\b/.test(normalizedText)) {
    return true;
  }

  return normalizedText.split(/\s+/).length >= 2;
}

function stripLeadingCityFromAddressCandidate(text: string): string {
  const normalizedText = normalizeText(text);

  for (const cityAlias of cityAliases) {
    for (const alias of cityAlias.aliases) {
      const normalizedAlias = normalizeText(alias);

      if (normalizedText === normalizedAlias) {
        return "";
      }

      if (normalizedText.startsWith(`${normalizedAlias} `)) {
        return normalizedText.slice(normalizedAlias.length).trim();
      }
    }
  }

  return normalizedText;
}

function stripKnownOrderTokensFromAddress(text: string): string {
  let cleaned = normalizeText(text);

  for (const colorAlias of colorAliases) {
    for (const alias of colorAlias.aliases) {
      cleaned = cleaned.replace(
        new RegExp(`(^|\\s)${normalizeText(alias)}(?=\\s|$)`, "g"),
        " ",
      );
    }
  }

  return cleaned
    .replace(/(^|\s)(3[6-9]|4[0-5])(?=\s|$)/g, " ")
    .replace(
      /(^|\s)(wa7da|wahda|w7da|wahed|wahd|واحدة|وحدة|واحد|jouj|jooj|جوج|زوج)(?=\s|$)/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function findAddressAfterPhone(message: string, phone: string): string | undefined {
  const phoneText = getPhoneTextFromMessage(message, phone);

  if (!phoneText) {
    return undefined;
  }

  const phoneIndex =
    message.indexOf(phoneText) >= 0
      ? message.indexOf(phoneText)
      : normalizeText(message).indexOf(normalizeText(phoneText));

  if (phoneIndex < 0) {
    return undefined;
  }

  const addressCandidate = message.slice(phoneIndex + phoneText.length).trim();
  const address = stripLeadingCityFromAddressCandidate(
    stripAfterQuantityMarker(addressCandidate),
  );
  const cleanedAddress = stripKnownOrderTokensFromAddress(address);

  return looksLikeAddressText(cleanedAddress) ? cleanedAddress : undefined;
}

function findAddressAfterDetectedPhone(message: string): string | undefined {
  const phoneMatch = message.match(/(?:\+212|0)[67]\d{8}\b/);
  const phoneText = phoneMatch?.[0];

  if (!phoneText) {
    return undefined;
  }

  const address = stripLeadingCityFromAddressCandidate(
    stripAfterQuantityMarker(
      message.slice((phoneMatch.index || 0) + phoneText.length).trim(),
    ),
  );
  const cleanedAddress = stripKnownOrderTokensFromAddress(address);

  return looksLikeAddressText(cleanedAddress) ? cleanedAddress : undefined;
}

function cleanLabeledValue(value: string): string {
  return value
    .replace(/^(هو|هي|ديالي|ديال|ب|:|-)\s*/i, "")
    .replace(
      /\b(الاسم|السميه|السمية|الهاتف|التلفون|تلفون|رقم الهاتف|رقم|المدينة|العنوان|المقاس|قياس|اللون|الكمية|name|nom|phone|tel|city|ville|address|adresse|size|taille|color|couleur|quantity|qte)\b.*$/i,
      "",
    )
    .trim();
}

function findLabeledValue(message: string, labels: string[]): string | undefined {
  const normalizedMessage = normalizeText(message);

  for (const label of labels) {
    const normalizedLabel = normalizeText(label);
    const labelIndex = normalizedMessage.indexOf(normalizedLabel);

    if (labelIndex < 0) {
      continue;
    }

    const value = cleanLabeledValue(
      normalizedMessage.slice(labelIndex + normalizedLabel.length).trim(),
    );

    if (value) {
      return value;
    }
  }

  return undefined;
}

function findNameBeforePhone(message: string, phone: string): string | undefined {
  const phoneText = getPhoneTextFromMessage(message, phone);

  if (!phoneText) {
    return undefined;
  }

  const phoneIndex = message.indexOf(phoneText);

  if (phoneIndex <= 0) {
    return undefined;
  }

  return message.slice(0, phoneIndex).trim().split(/\s+/).slice(0, 3).join(" ");
}

function isSimpleArabicName(message: string): boolean {
  const normalizedMessage = normalizeText(message);
  const looksLikeOrderCommand = includesAny(normalizedMessage, [
    "بغيت",
    "نكوموندي",
    "نكومندي",
    "نكوموند",
    "نطلب",
    "الطلب",
    "كومند",
    "كوموند",
    "كوموندي",
    "صوب",
    "صايب",
    "دير ليا",
  ]);
  const looksLikeQuestionOrSmallTalk =
    normalizedMessage.includes("؟") ||
    includesAny(normalizedMessage, [
      "شنو",
      "واش",
      "اش",
      "رأيك",
      "رايك",
      "الماتش",
      "ماتش",
      "كيفاش",
      "فين",
      "علاش",
    ]);

  return (
    /^[\u0600-\u06ff\s]{2,30}$/.test(normalizedMessage) &&
    !looksLikeOrderCommand &&
    !looksLikeQuestionOrSmallTalk &&
    normalizedMessage.split(/\s+/).length <= 3 &&
    !findCity(message) &&
    !findColor(message) &&
    !findAddress(message)
  );
}

function extractStandaloneEntities(
  message: string,
  missingFields: string[],
  requiredFields?: RequiredOrderField[],
): Partial<OrderEntities> {
  const entities = {} as Record<string, unknown>;
  const phone = findPhone(message);

  if (phone && missingFields.includes("phone")) {
    entities.phone = phone;
  }

  if (phone && missingFields.includes("fullName")) {
    entities.fullName = findNameBeforePhone(message, phone);
  }

  if (phone && missingFields.includes("address")) {
    entities.address =
      findAddressAfterDetectedPhone(message) ||
      findAddressAfterPhone(message, phone);
  }

  if (missingFields.includes("city")) {
    entities.city = findCity(message);
  }

  if (missingFields.includes("size")) {
    entities.size = findSize(message);
  }

  if (missingFields.includes("color")) {
    entities.color = findColor(message);
  }

  const isStandaloneMissingSizeSelection =
    missingFields.includes("size") &&
    typeof entities.size === "string" &&
    isStandaloneSizeSelection(message, entities.size);

  if (
    !isStandaloneMissingSizeSelection &&
    (missingFields.includes("quantity") ||
      shouldCollectOptionalQuantity(message))
  ) {
    entities.quantity = findQuantity(message);
  }

  for (const field of requiredFields || []) {
    if (
      field.source !== "productOption" ||
      !field.options?.length ||
      !missingFields.includes(field.key) ||
      hasValue(entities[field.key])
    ) {
      continue;
    }

    const configuredOption = findConfiguredOption(message, field.options);

    if (configuredOption) {
      entities[field.key] = configuredOption;
    }
  }

  if (!entities.address && missingFields.includes("address")) {
    entities.address = findAddress(message);
  }

  if (!entities.fullName && missingFields.includes("fullName") && isSimpleArabicName(message)) {
    entities.fullName = normalizeText(message);
  }

  return cleanEntities(entities as OrderEntities);
}

function mergeEntities(
  existing: OrderEntities,
  incoming: Partial<OrderEntities>,
): OrderEntities {
  const merged: OrderEntities = { ...existing };

  for (const [key, value] of Object.entries(incoming) as Array<[
    keyof OrderEntities,
    OrderEntities[keyof OrderEntities],
  ]>) {
    if (hasValue(value) && !hasValue(merged[key])) {
      (merged[key] as typeof value) = value;
    }
  }

  return merged;
}

function mergeCorrectedEntities(
  existing: OrderEntities,
  incoming: Partial<OrderEntities>,
): OrderEntities {
  const merged: OrderEntities = { ...existing };

  for (const [key, value] of Object.entries(incoming) as Array<[
    keyof OrderEntities,
    OrderEntities[keyof OrderEntities],
  ]>) {
    if (hasValue(value)) {
      (merged[key] as typeof value) = value;
    }
  }

  return merged;
}

function isStandaloneSizeSelection(message: string, size?: string): boolean {
  if (!size) {
    return false;
  }

  return normalizeText(message) === normalizeText(size);
}

function hasCollectedOrderData(collected: OrderEntities): boolean {
  return Object.values(collected).some((value) => hasValue(value));
}

function isOrderStartMessage(message: string): boolean {
  const normalizedMessage = normalizeText(message);
  const hasDarijaWantVerb = includesAny(normalizedMessage, [
    "بغيت",
    "باغي",
    "باغية",
    "عافاك",
  ]);
  const hasOrderWord = includesAny(normalizedMessage, [
    "كوم",
    "كموند",
    "كومند",
    "كوموند",
    "طلب",
    "نطلب",
    "ناخد",
    "ناخذ",
    "commande",
    "commander",
    "order",
    "ncommand",
    "ncommande",
    "nkomand",
    "nkomandi",
    "nakhod",
    "nakhoud",
  ]);

  return (
    (hasDarijaWantVerb && hasOrderWord) ||
    [
      "first_entry:order_now",
      "الطلب",
      "طلب",
      "commande",
      "order",
      "كومند",
      "كوموند",
      "كوموندي",
    ].includes(normalizedMessage) ||
    includesAny(normalizedMessage, [
      "بغيت نكوموندي",
      "بغيت نكومندي",
      "بغيت نكوماند",
      "بغيت نكوموند",
      "بغيت كوموند",
      "بغيت الطلب",
      "بغيت ناخد",
      "بغيت ناخذ",
      "نطلب",
      "دير ليا الطلب",
      "وجد ليا الطلب",
      "صوب ليا الطلب",
      "صايب ليا الطلب",
      "تصوب لي كومند",
      "تصوب لي كوموند",
      "bghit ncommande",
      "bghit ncommandi",
      "bghit ncommander",
      "bghit nkomandi",
      "bghit commande",
      "bghit order",
      "bghit nakhod",
      "bghit nakhoud",
      "dir lia commande",
      "dir lia order",
      "commander",
    ])
  );
}

function isConfirmationMessage(message: string): boolean {
  const normalizedMessage = normalizeText(message);

  if (
    hasRejectionIntent(normalizedMessage) ||
    includesAny(normalizedMessage, correctionKeywords)
  ) {
    return false;
  }

  return confirmationMessages.some((messagePattern) => {
    const normalizedPattern = normalizeText(messagePattern);

    return (
      normalizedMessage === normalizedPattern ||
      normalizedMessage.startsWith(`${normalizedPattern} `) ||
      normalizedMessage.endsWith(` ${normalizedPattern}`) ||
      normalizedMessage.includes(` ${normalizedPattern} `)
    );
  });
}

function hasRejectionIntent(normalizedMessage: string): boolean {
  return (
    isExactMessage(normalizedMessage, negativeCorrectionMessages) ||
    normalizedMessage.startsWith("لا ")
  );
}

function isCancellationMessage(message: string): boolean {
  return isExactMessage(normalizeText(message), cancellationMessages);
}

function hasCorrectionOrRejectionIntent(message: string): boolean {
  const normalizedMessage = normalizeText(message);

  return (
    hasRejectionIntent(normalizedMessage) ||
    includesAny(normalizedMessage, correctionKeywords)
  );
}

function hasFieldKeyword(normalizedMessage: string, labels: string[]): boolean {
  return includesAny(normalizedMessage, labels);
}

function extractCorrectionEntities(message: string): Partial<OrderEntities> {
  const normalizedMessage = normalizeText(message);
  const corrections: Partial<OrderEntities> = {};
  const wantsChange = includesAny(normalizedMessage, correctionKeywords);
  const phone = findPhone(message);
  const hasPhoneKeyword = hasFieldKeyword(normalizedMessage, [
    "رقم الهاتف",
    "الهاتف",
    "التلفون",
    "تلفون",
    "رقم",
    "phone",
    "tel",
  ]);
  const hasCityKeyword = hasFieldKeyword(normalizedMessage, [
    "المدينة",
    "مدينه",
    "ville",
    "city",
  ]);
  const hasAddressKeyword = hasFieldKeyword(normalizedMessage, [
    "العنوان",
    "address",
    "adresse",
  ]);
  const hasSizeKeyword = hasFieldKeyword(normalizedMessage, [
    "المقاس",
    "قياس",
    "size",
    "taille",
  ]);
  const hasColorKeyword = hasFieldKeyword(normalizedMessage, [
    "اللون",
    "لون",
    "color",
    "couleur",
  ]);
  const hasQuantityKeyword = hasFieldKeyword(normalizedMessage, [
    "الكمية",
    "كمية",
    "quantity",
    "qte",
  ]);

  const fullName = findLabeledValue(message, [
    "الاسم الكامل",
    "الإسم الكامل",
    "الاسم",
    "الإسم",
    "السميه",
    "السمية",
    "name",
    "nom",
  ]);

  if (fullName) {
    corrections.fullName = fullName;
  }

  if (phone && (hasPhoneKeyword || wantsChange || normalizedMessage === phone)) {
    corrections.phone = phone;

    if (!corrections.fullName) {
      corrections.fullName = findNameBeforePhone(message, phone);
    }
  }

  const city = findCity(message);

  if (city && (hasCityKeyword || wantsChange || isKnownCityOnly(message))) {
    corrections.city = city;
  }

  const labeledAddress = findLabeledValue(message, [
    "العنوان",
    "address",
    "adresse",
  ]);
  const address =
    labeledAddress ||
    (phone ? findAddressAfterPhone(message, phone) : undefined) ||
    (hasAddressKeyword ||
    wantsChange ||
    /^(حي|شارع|زنقة|رقم)\b/.test(normalizedMessage)
      ? findAddress(message)
      : undefined);

  if (address && looksLikeAddressText(address)) {
    corrections.address = address;
  }

  const size = findSize(message);

  if (size && (hasSizeKeyword || wantsChange)) {
    corrections.size = size;
  }

  const color = findColor(message);

  if (color && (hasColorKeyword || wantsChange || isKnownColorOnly(message))) {
    corrections.color = color;
  }

  const quantity = findQuantity(message);

  if (quantity && (hasQuantityKeyword || wantsChange)) {
    corrections.quantity = quantity;
  }

  return cleanEntities(corrections);
}

function extractEditFieldEntities(
  message: string,
  field: EditableOrderField,
  requiredFields?: RequiredOrderField[],
): Partial<OrderEntities> {
  if (field === "delivery_info") {
    return extractStandaloneEntities(message, [
      "fullName",
      "phone",
      "city",
      "address",
    ], requiredFields);
  }

  const entities: Partial<OrderEntities> = {};

  if (field === "size") {
    entities.size = findSize(message);
  } else if (field === "color") {
    entities.color = findColor(message);
  } else if (field === "quantity") {
    entities.quantity = findQuantity(message);
  } else if (field === "fullName") {
    entities.fullName =
      findLabeledValue(message, [
        "الاسم الكامل",
        "الإسم الكامل",
        "الاسم",
        "الإسم",
        "السميه",
        "السمية",
        "name",
        "nom",
      ]) || normalizeText(message);
  } else if (field === "phone") {
    entities.phone = findPhone(message);
  } else if (field === "city") {
    entities.city = findCity(message) || normalizeText(message);
  } else if (field === "address") {
    entities.address =
      findLabeledValue(message, ["العنوان", "address", "adresse"]) ||
      findAddress(message) ||
      normalizeText(message);
  }

  return cleanEntities(entities as OrderEntities);
}

async function updateOrderDraftAndRenderSummary(input: {
  session: ConversationSession;
  customerId: string;
  customerPhone?: string;
  sellerId?: string;
  productId?: string;
  incomingEntities: Partial<OrderEntities>;
  productContext: ProductContext;
  requiredFields?: RequiredOrderField[];
}): Promise<ProcessOrderTurnResult> {
  const validatedEntities = validateIncomingOrderEntities(
    input.incomingEntities,
    input.productContext,
    input.requiredFields,
  );

  if (validatedEntities.reply) {
    return {
      handled: true,
      reply: validatedEntities.reply,
      isComplete: input.session.orderState.isComplete,
      missingFields: input.session.orderState.missingFields,
    };
  }

  const collected = mergeCorrectedEntities(
    input.session.orderState.collected,
    validatedEntities.entities,
  );
  const missingFields = computeMissingFields(
    collected,
    input.productContext,
    input.requiredFields,
  );
  const isComplete = missingFields.length === 0;

  await updateConversationOrderState({
    customerId: input.customerId,
    customerPhone: input.customerPhone,
    sellerId: input.sellerId,
    productId: input.productId,
    collected,
    missingFields,
    isComplete,
    awaitingConfirmation: isComplete,
    confirmed: false,
    editField: null,
  });

  const renderedReply = renderOrderProgressReply({
    collected,
    missingFields,
    isComplete,
    productContext: input.productContext,
    requiredFields: input.requiredFields,
  });

  return {
    handled: true,
    reply: renderedReply.text,
    replyUi: renderedReply.ui,
    replyPresentation: renderedReply.presentation,
    isComplete,
    missingFields,
  };
}

async function processConfirmationTurn(input: {
  session: ConversationSession;
  customerId: string;
  customerPhone?: string;
  sellerId?: string;
  productId?: string;
  message: string;
  productContext: ProductContext;
  requiredFields?: RequiredOrderField[];
}): Promise<ProcessOrderTurnResult> {
  const pendingEditField = input.session.orderState.editField;

  if (pendingEditField) {
    const entities = extractEditFieldEntities(
      input.message,
      pendingEditField,
      input.requiredFields,
    );

    if (Object.keys(entities).length === 0) {
      const prompt = buildEditFieldPrompt(pendingEditField, input.requiredFields);

      return {
        handled: true,
        reply: prompt.text,
        replyUi: prompt.ui,
        isComplete: input.session.orderState.isComplete,
        missingFields: input.session.orderState.missingFields,
      };
    }

    return updateOrderDraftAndRenderSummary({
      session: input.session,
      customerId: input.customerId,
      customerPhone: input.customerPhone,
      sellerId: input.sellerId,
      productId: input.productId,
      incomingEntities: entities,
      productContext: input.productContext,
      requiredFields: input.requiredFields,
    });
  }

  const selectedEditField = getEditFieldFromMessage(input.message);

  if (selectedEditField) {
    const prompt = buildEditFieldPrompt(selectedEditField, input.requiredFields);

    await updateConversationOrderState({
      customerId: input.customerId,
      customerPhone: input.customerPhone,
      sellerId: input.sellerId,
      productId: input.productId,
      editField: selectedEditField,
    });

    return {
      handled: true,
      reply: prompt.text,
      replyUi: prompt.ui,
      isComplete: input.session.orderState.isComplete,
      missingFields: input.session.orderState.missingFields,
    };
  }

  if (isConfirmationMessage(input.message)) {
    const missingFields = computeMissingFields(
      input.session.orderState.collected,
      input.productContext,
      input.requiredFields,
    );

    if (missingFields.length > 0) {
      await updateConversationOrderState({
        customerId: input.customerId,
        customerPhone: input.customerPhone,
        sellerId: input.sellerId,
        productId: input.productId,
        collected: input.session.orderState.collected,
        missingFields,
        isComplete: false,
        awaitingConfirmation: false,
        confirmed: false,
      });
      recordOrderConfirmationBlockedInvalidFields({
        invalidFields: missingFields,
      });

      const renderedReply = renderOrderProgressReply({
        collected: input.session.orderState.collected,
        missingFields,
        isComplete: false,
        productContext: input.productContext,
        requiredFields: input.requiredFields,
      });

      return {
        handled: true,
        reply: renderedReply.text,
        replyUi: renderedReply.ui,
        isComplete: false,
        missingFields,
      };
    }

    const order = saveConfirmedOrder({
      customerId: input.customerId,
      orderCycleId: input.session.orderState.orderCycleId,
      sellerId: input.sellerId,
      customerPhone: input.customerPhone,
      conversationKey: input.session.conversationKey || input.customerId,
      productContext: input.productContext,
      collected: input.session.orderState.collected,
      source: "agent",
    });

    await updateConversationOrderState({
      customerId: input.customerId,
      customerPhone: input.customerPhone,
      sellerId: input.sellerId,
      productId: input.productId,
      orderCycleId: input.session.orderState.orderCycleId,
      collected: input.session.orderState.collected,
      missingFields: [],
      isComplete: true,
      awaitingConfirmation: false,
      confirmed: true,
      editField: null,
    });

    return {
      handled: true,
      reply: buildConfirmedReply(order.publicOrderCode),
      orderJustConfirmed: true,
      confirmedOrderId: order.id,
      publicOrderCode: order.publicOrderCode,
      isComplete: true,
      missingFields: [],
    };
  }

  const corrections = extractCorrectionEntities(input.message);

  if (Object.keys(corrections).length > 0) {
    return updateOrderDraftAndRenderSummary({
      session: input.session,
      customerId: input.customerId,
      customerPhone: input.customerPhone,
      sellerId: input.sellerId,
      productId: input.productId,
      incomingEntities: corrections,
      productContext: input.productContext,
      requiredFields: input.requiredFields,
    });
  }

  if (
    hasRejectionIntent(normalizeText(input.message)) ||
    hasCorrectionOrRejectionIntent(input.message) ||
    isCancellationMessage(input.message)
  ) {
    const editReply = buildEditChoiceReply(
      hasRejectionIntent(normalizeText(input.message))
        ? "ماشي مشكل. شنو بغيتي تبدل في الطلب؟"
        : "شنو بغيتي تبدل في الطلب؟",
    );

    return {
      handled: true,
      reply: editReply.text,
      replyUi: editReply.ui,
      isComplete: input.session.orderState.isComplete,
      missingFields: input.session.orderState.missingFields,
    };
  }

  const editReply = buildEditChoiceReply(
    "ما فهمتش واش نأكد الطلب ولا بغيتي تبدل شي معلومة. شنو بغيتي تبدل؟",
  );

  return {
    handled: true,
    reply: editReply.text,
    replyUi: editReply.ui,
    isComplete: input.session.orderState.isComplete,
    missingFields: input.session.orderState.missingFields,
  };
}

async function processConfirmedOrderTurn(input: {
  session: ConversationSession;
  customerId: string;
  customerPhone?: string;
  sellerId?: string;
  productId?: string;
  message: string;
  productContext: ProductContext;
  requiredFields?: RequiredOrderField[];
}): Promise<ProcessOrderTurnResult> {
  const orderCycleId = input.session.orderState.orderCycleId;
  const existingOrder =
    getConfirmedOrderByCustomerId(input.customerId, orderCycleId) ||
    getConfirmedOrderByCustomerId(input.customerId) ||
    saveConfirmedOrder({
      customerId: input.customerId,
      orderCycleId,
      sellerId: input.sellerId,
      customerPhone: input.customerPhone,
      conversationKey: input.session.conversationKey || input.customerId,
      productContext: input.productContext,
      collected: input.session.orderState.collected,
      source: "agent",
    });

  if (isNewOrderIntent(input.message)) {
    const orderCycleId = randomUUID();
    const activeRequiredFields = getActiveRequiredFields(
      input.productContext,
      input.requiredFields,
    );
    const missingFields = computeMissingFields(
      {},
      input.productContext,
      activeRequiredFields,
    );

    await updateConversationOrderState({
      customerId: input.customerId,
      customerPhone: input.customerPhone,
      sellerId: input.sellerId,
      productId: input.productId,
      orderCycleId,
      collected: {},
      replaceCollected: true,
      missingFields,
      isComplete: false,
      awaitingConfirmation: false,
      confirmed: false,
      editField: null,
      clearProductInfo: true,
    });

    const renderedReply = renderOrderProgressReply({
      collected: {},
      missingFields,
      isComplete: false,
      productContext: input.productContext,
      requiredFields: activeRequiredFields,
    });

    return {
      handled: true,
      reply: `أكيد، نبدأو طلب جديد.\n${stripOrderStartIntro(renderedReply.text)}`,
      replyUi: renderedReply.ui,
      isComplete: false,
      missingFields,
    };
  }

  if (
    hasCorrectionOrRejectionIntent(input.message) ||
    getEditFieldFromMessage(input.message)
  ) {
    return {
      handled: true,
      reply: buildConfirmedEditBlockedReply(existingOrder.publicOrderCode),
      isComplete: true,
      missingFields: [],
    };
  }

  if (isDuplicateConfirmationIntent(input.message)) {
    return {
      handled: true,
      reply: buildAlreadyConfirmedReply(existingOrder.publicOrderCode),
      isComplete: true,
      missingFields: [],
    };
  }

  if (isBlessingThanksMessage(input.message)) {
    return {
      handled: true,
      reply: "آمين، الله يسلمك 😊",
      isComplete: true,
      missingFields: [],
    };
  }

  if (isThanksMessage(input.message)) {
    return {
      handled: true,
      reply:
        "العفو 🙌\nغادي يتواصل معاك فريق المتجر لتأكيد التوصيل.",
      isComplete: true,
      missingFields: [],
    };
  }

  return {
    handled: false,
    isComplete: true,
    missingFields: [],
  };
}

function shouldTreatAsOrderFlow(input: {
  intent?: string;
  existingCollected: OrderEntities;
  currentMissingFields: string[];
  standaloneEntities: Partial<OrderEntities>;
  hasActiveOrderFlow: boolean;
}): boolean {
  if (
    input.intent === "order_intent" ||
    input.intent === "order_info_provided" ||
    input.intent === "order_start" ||
    input.intent === "order_followup"
  ) {
    return true;
  }

  if (!hasCollectedOrderData(input.existingCollected)) {
    return (
      input.hasActiveOrderFlow &&
      input.currentMissingFields.length > 0 &&
      hasCollectedOrderData(input.standaloneEntities)
    );
  }

  return input.currentMissingFields.length > 0;
}

export async function processOrderTurn(
  input: ProcessOrderTurnInput,
): Promise<ProcessOrderTurnResult> {
  const activeRequiredFields = getActiveRequiredFields(
    input.productContext,
    input.requiredFields,
  );
  const session = await sanitizeStoredOrderState(
    await getConversationSession(
      input.customerId,
      input.sellerId,
      input.productId,
      input.customerPhone,
    ),
    input.productContext,
    activeRequiredFields,
  );

  if (session.orderState.confirmed) {
    return processConfirmedOrderTurn({
      session,
      customerId: input.customerId,
      customerPhone: input.customerPhone,
      sellerId: input.sellerId,
      productId: input.productId,
      message: input.message,
      productContext: input.productContext,
      requiredFields: activeRequiredFields,
    });
  }

  if (
    session.orderState.awaitingConfirmation &&
    session.orderState.isComplete &&
    !session.orderState.confirmed
  ) {
    return processConfirmationTurn({
      session,
      customerId: input.customerId,
      customerPhone: input.customerPhone,
      sellerId: input.sellerId,
      productId: input.productId,
      message: input.message,
      productContext: input.productContext,
      requiredFields: activeRequiredFields,
    });
  }

  const fastAnalysis = fastAnalyzeCustomerMessage(input.message);
  const fallbackOrderStartAnalysis = isOrderStartMessage(input.message)
    ? ({
        intent: "order_intent",
        entities: {},
      } satisfies ProcessOrderTurnInput["analysis"])
    : undefined;
  const analysis = input.analysis || fastAnalysis || fallbackOrderStartAnalysis;
  const currentMissingFields =
    session.orderState.missingFields.length > 0
      ? session.orderState.missingFields
      : computeMissingFields(
          session.orderState.collected,
          input.productContext,
          activeRequiredFields,
        );
  const standaloneEntities = extractStandaloneEntities(
    input.message,
    currentMissingFields,
    activeRequiredFields,
  );
  const shouldHandle = shouldTreatAsOrderFlow({
    intent: analysis?.intent,
    existingCollected: session.orderState.collected,
    currentMissingFields,
    standaloneEntities,
    hasActiveOrderFlow: session.orderState.missingFields.length > 0,
  });

  if (!shouldHandle) {
    return {
      handled: false,
      isComplete: session.orderState.isComplete,
      missingFields: session.orderState.missingFields,
    };
  }

  const incomingEntities = {
    ...cleanEntities(analysis?.entities || {}),
    ...standaloneEntities,
  };
  const validatedIncomingEntities = validateIncomingOrderEntities(
    incomingEntities,
    input.productContext,
    activeRequiredFields,
  );

  if (validatedIncomingEntities.reply) {
    return {
      handled: true,
      reply: validatedIncomingEntities.reply,
      isComplete: session.orderState.isComplete,
      missingFields: currentMissingFields,
    };
  }

  const shouldUpdateSelectedSize =
    session.orderState.missingFields.length > 0 &&
    isStandaloneSizeSelection(input.message, validatedIncomingEntities.entities.size);
  const collected = shouldUpdateSelectedSize
    ? mergeEntities(
        mergeCorrectedEntities(session.orderState.collected, {
          size: validatedIncomingEntities.entities.size,
        }),
        {
          ...validatedIncomingEntities.entities,
          size: undefined,
        },
      )
    : mergeEntities(
        session.orderState.collected,
        validatedIncomingEntities.entities,
      );
  const missingFields = computeMissingFields(
    collected,
    input.productContext,
    activeRequiredFields,
  );
  const isComplete = missingFields.length === 0;
  const awaitingConfirmation = isComplete;

  await updateConversationOrderState({
    customerId: input.customerId,
    customerPhone: input.customerPhone,
    sellerId: input.sellerId,
    productId: input.productId,
    collected,
    missingFields,
    isComplete,
    awaitingConfirmation,
    confirmed: false,
  });

  const renderedReply = renderOrderProgressReply({
    collected,
    missingFields,
    isComplete,
    productContext: input.productContext,
    requiredFields: activeRequiredFields,
  });

  return {
    handled: true,
    reply: renderedReply.text,
    replyUi: renderedReply.ui,
    replyPresentation: renderedReply.presentation,
    isComplete,
    missingFields,
  };
}
