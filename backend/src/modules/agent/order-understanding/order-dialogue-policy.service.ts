import type { OrderUnderstandingContext } from "./order-understanding.types";

export function buildFieldClarification(context: OrderUnderstandingContext, reason?: string): string {
  const field = context.awaitedField;
  if (!field) {
    return "عافاك صيفط ليا المعلومات اللي باقا باش نكملو الطلب.";
  }

  if (field.key === "city") {
    return reason === "invalid_location"
      ? "ما فهمتش المدينة مزيان. كتب ليا غير اسم المدينة أو المنطقة."
      : "عافاك كتب ليا اسم المدينة أو المنطقة ديالك.";
  }

  if (field.key === "address") {
    return "عافاك صيفط ليا العنوان بالتدريج: الحي، الزنقة أو رقم الدار.";
  }

  if (field.key === "fullName") {
    return "عافاك عطيني غير الاسم الكامل ديالك.";
  }

  return field.prompt || `عافاك صيفط ليا ${field.label}.`;
}
