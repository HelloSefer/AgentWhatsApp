import type { OrderEntities } from "../agent-brain.types";
import type { RequiredOrderField } from "../config/required-fields.types";
import type { RenderedAgentReply } from "./reply-renderer.types";

const summaryLabelOverrides: Record<string, string> = {
  fullName: "الاسم",
  phone: "الهاتف",
  city: "المدينة",
  address: "العنوان",
  productName: "المنتوج",
  variant: "النوع",
  color: "اللون",
  size: "المقاس",
  quantity: "الكمية",
  notes: "ملاحظات",
};

const fieldPromptOverrides: Record<string, string> = {
  size: "اختار المقاس المناسب ليك.",
  color: "اختار اللون اللي بغيتي.",
  quantity: "شحال من وحدة بغيتي؟",
  fullName: "عافاك عطيني غير الاسم الكامل ديالك.",
  phone: "عافاك عطيني رقم الهاتف.",
  city: "شنو المدينة ديالك؟",
  address: "عافاك عطيني العنوان الكامل ديال التوصيل.",
};

const deliveryFieldKeys = ["fullName", "phone", "city", "address"];
const groupedDeliveryPrompt = [
  "عافاك عطيني معلومات التوصيل:",
  "الاسم + الهاتف + المدينة + العنوان",
].join("\n");

function hasValue(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0;
  }

  return typeof value === "string" ? Boolean(value.trim()) : Boolean(value);
}

function formatValue(value: unknown): string {
  return typeof value === "number" ? String(value) : String(value).trim();
}

function getSummaryLabel(field: RequiredOrderField): string {
  return summaryLabelOverrides[field.key] || field.label;
}

function toSummaryField(field: keyof OrderEntities, askOrder: number): RequiredOrderField {
  return {
    key: field,
    label: summaryLabelOverrides[field],
    required: true,
    enabled: true,
    source: "customerField",
    askOrder,
  };
}

export class DynamicReplyRenderer {
  formatFieldList(fields: Array<{ label: string }>): string {
    const labels = fields
      .map((field) => field.label.trim())
      .filter(Boolean);

    if (labels.length <= 1) {
      return labels.join("");
    }

    return `${labels.slice(0, -1).join("، ")} و${labels[labels.length - 1]}`;
  }

  getCollectedLabels(input: {
    collected: Record<string, unknown>;
    requiredFields: RequiredOrderField[];
    quantity?: number | string;
  }): string[] {
    const labels: string[] = [];
    const fieldByKey = new Map(
      input.requiredFields.map((field) => [field.key, field]),
    );
    const allowedKeys = new Set([...fieldByKey.keys(), "quantity"]);

    const pushKnownField = (
      key: string,
      formatter: (value: unknown) => string,
    ) => {
      const value = input.collected[key];

      if (allowedKeys.has(key) && hasValue(value)) {
        labels.push(formatter(value));
      }
    };

    pushKnownField("size", (value) => `المقاس ${formatValue(value)}`);
    pushKnownField("color", (value) => `اللون ${formatValue(value)}`);
    pushKnownField("city", (value) => `المدينة ${formatValue(value)}`);
    pushKnownField("fullName", (value) => `الاسم ${formatValue(value)}`);
    pushKnownField("phone", () => "رقم الهاتف");
    pushKnownField("address", () => "العنوان");
    pushKnownField("quantity", (value) => `الكمية ${formatValue(value)}`);

    for (const field of input.requiredFields) {
      if (summaryLabelOverrides[field.key]) {
        continue;
      }

      const value = input.collected[field.key];

      if (hasValue(value)) {
        labels.push(`${field.label} ${formatValue(value)}`);
      }
    }

    if (!hasValue(input.collected.quantity) && hasValue(input.quantity)) {
      labels.push(`الكمية ${formatValue(input.quantity)}`);
    }

    return labels;
  }

  renderOrderStart(input: {
    missingFields: RequiredOrderField[];
  }): RenderedAgentReply {
    const nextField = input.missingFields[0];
    const prompt = this.getNextPrompt(input.missingFields);

    return {
      text: ["تمام ✅", "نبدأو الطلب ديالك.", "", prompt].join("\n"),
      ui: nextField
        ? this.buildFieldUiHint(nextField, prompt, "order_start")
        : {
            kind: "auto",
            purpose: "order_start",
            title: "معلومات الطلب",
            body: "صيفط ليا المعلومات المطلوبة باش نوجد لك الطلب.",
            options: [],
          },
    };
  }

  renderMissingFields(input: {
    collectedLabels?: string[];
    missingFields: RequiredOrderField[];
  }): RenderedAgentReply {
    const nextField = input.missingFields[0];
    const prompt = this.getNextPrompt(input.missingFields);

    return {
      text: prompt,
      ui: nextField
        ? this.buildFieldUiHint(nextField, prompt, "missing_fields")
        : {
            kind: "auto",
            purpose: "missing_fields",
            title: "باقي معلومات",
            body: prompt,
            options: [],
          },
    };
  }

  renderOrderSummary(input: {
    collected: Record<string, unknown>;
    requiredFields: RequiredOrderField[];
    quantity?: number | string;
  }): RenderedAgentReply {
    const summaryLines = this.buildSummaryLines(input);

    if (!summaryLines.length) {
      return {
        text: "تمام، توصلت بجميع معلومات الطلب.\n\nواش نأكد لك الطلب؟",
        ui: {
          kind: "buttons",
          purpose: "confirmation",
          title: "تأكيد الطلب",
          options: this.buildConfirmationOptions(),
        },
      };
    }

    return {
      text: [
        "تمام، توصلت بجميع معلومات الطلب.",
        "",
        "هذا هو الطلب ديالك:",
        ...summaryLines,
        "",
        "واش نأكد لك الطلب؟",
      ].join("\n"),
      ui: {
        kind: "buttons",
        purpose: "confirmation",
        title: "تأكيد الطلب",
        body: summaryLines.join("\n"),
        options: this.buildConfirmationOptions(),
      },
    };
  }

  renderConfirmationSuccess(): RenderedAgentReply {
    return {
      text: "تم تأكيد الطلب ديالك بنجاح. غادي نتواصلو معاك قريباً.",
      ui: {
        kind: "none",
        purpose: "confirmation",
      },
    };
  }

  private buildSummaryLines(input: {
    collected: Record<string, unknown>;
    requiredFields: RequiredOrderField[];
    quantity?: number | string;
  }): string[] {
    const fields = input.requiredFields.length
      ? [...input.requiredFields]
      : [
          toSummaryField("fullName", 1),
          toSummaryField("phone", 2),
          toSummaryField("city", 3),
          toSummaryField("address", 4),
          toSummaryField("size", 5),
          toSummaryField("color", 6),
          toSummaryField("quantity", 7),
          toSummaryField("productName", 8),
          toSummaryField("variant", 9),
          toSummaryField("notes", 10),
        ];
    const shouldShowQuantity =
      hasValue(input.collected.quantity) ||
      (!fields.some((field) => field.key === "quantity") &&
        hasValue(input.quantity));
    const summaryFields = shouldShowQuantity
      ? [
          ...fields,
          ...(fields.some((field) => field.key === "quantity")
            ? []
            : [toSummaryField("quantity", fields.length + 1)]),
        ]
      : fields;

    return summaryFields.flatMap((field) => {
      const value =
        field.key === "quantity" && !hasValue(input.collected.quantity)
          ? input.quantity
          : input.collected[field.key];

      if (!hasValue(value)) {
        return [];
      }

      return `${getSummaryLabel(field)}: ${formatValue(value)}`;
    });
  }

  private buildFieldOptions(
    fields: RequiredOrderField[],
  ): Array<{ id: string; label: string; value?: string }> {
    return fields.map((field) => ({
      id: field.key,
      label: field.label,
      value: field.key,
    }));
  }

  private getNextOptionField(
    fields: RequiredOrderField[],
  ): RequiredOrderField | undefined {
    return fields.find(
      (field) => field.source === "productOption" && Boolean(field.options?.length),
    );
  }

  private buildOptionFieldUiHint(field: RequiredOrderField): RenderedAgentReply["ui"] {
    const optionCount = field.options?.length || 0;
    const prefersButtons = field.display === "buttons" && optionCount <= 3;
    const kind = prefersButtons ? "buttons" : "list";

    return {
      kind,
      purpose: "field_options",
      title: `اختار ${field.label}`,
      body: field.label,
      options: (field.options || []).map((option) => ({
        id: `${field.key}:${option}`,
        label: option,
        value: option,
      })),
    };
  }

  private buildFieldUiHint(
    field: RequiredOrderField,
    prompt: string,
    purpose: "order_start" | "missing_fields",
  ): RenderedAgentReply["ui"] {
    if (field.source === "productOption" && field.options?.length) {
      const optionCount = field.options.length;
      const prefersButtons =
        (field.display === "buttons" || field.display === "auto") &&
        optionCount <= 3;

      return {
        kind: prefersButtons ? "buttons" : "list",
        purpose: "field_options",
        title: `اختار ${field.label}`,
        body: prompt,
        options: field.options.map((option) => ({
          id: `${field.key}:${option}`,
          label: option,
          value: option,
        })),
      };
    }

    return {
      kind: "auto",
      purpose,
      title: field.label,
      body: prompt,
      options: [],
    };
  }

  private getFieldPrompt(field: RequiredOrderField | undefined): string {
    if (!field) {
      return "صيفط ليا المعلومات المطلوبة باش نوجد لك الطلب.";
    }

    return field.prompt || fieldPromptOverrides[field.key] || `عافاك عطيني ${field.label}.`;
  }

  private getNextPrompt(fields: RequiredOrderField[]): string {
    const missingKeys = new Set(fields.map((field) => field.key));
    const hasConfiguredDeliveryPrompt = fields.some(
      (field) => deliveryFieldKeys.includes(field.key) && Boolean(field.prompt),
    );
    const allDeliveryFieldsMissing =
      fields[0]?.key === "fullName" &&
      !hasConfiguredDeliveryPrompt &&
      deliveryFieldKeys.every((key) => missingKeys.has(key));

    if (allDeliveryFieldsMissing) {
      return groupedDeliveryPrompt;
    }

    return this.getFieldPrompt(fields[0]);
  }

  private buildConfirmationOptions(): Array<{
    id: string;
    label: string;
    value?: string;
  }> {
    return [
      {
        id: "confirm:yes",
        label: "نعم",
        value: "نعم",
      },
      {
        id: "confirm:edit",
        label: "تعديل",
        value: "تعديل",
      },
    ];
  }
}

export const dynamicReplyRenderer = new DynamicReplyRenderer();
