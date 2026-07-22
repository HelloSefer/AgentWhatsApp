export const CONVERSATION_LOCALES = ["ar-MA"] as const;

export type ConversationLocale = (typeof CONVERSATION_LOCALES)[number];

export const CONVERSATION_MESSAGE_KEYS = [
  "first_entry.commercial_intro",
  "first_entry.product_with_price",
  "first_entry.product_only",
  "first_entry.price_only",
  "first_entry.delivery_all_free",
  "first_entry.delivery_all_paid",
  "first_entry.delivery_all_unspecified",
  "first_entry.delivery_selected_cities",
  "first_entry.delivery_excluded_cities",
  "first_entry.delivery_by_city",
  "first_entry.delivery_unavailable",
  "first_entry.payment_available",
  "first_entry.delivery_with_icon",
  "first_entry.cta_order_only_friendly",
  "first_entry.cta_order_only_professional",
  "first_entry.cta_info_only_friendly",
  "first_entry.cta_info_only_professional",
  "first_entry.cta_both_short",
  "first_entry.cta_both_friendly",
  "first_entry.cta_both_professional",
  "information.opening",
  "information.menu_opening",
  "information.size_list",
  "information.color_list",
  "information.option_available_size",
  "information.option_available_color",
  "information.size_followup",
  "information.color_followup",
  "information.text_followup",
  "information.how_to_order",
  "information.availability_unknown",
  "information.availability_with_offer",
  "information.price_unknown",
  "information.price",
  "information.sizes_unknown",
  "information.colors_unknown",
  "information.delivery_payment_unknown",
  "information.delivery_free",
  "information.delivery_paid",
  "information.delivery_variable",
  "information.delivery_detail",
  "information.payment_available",
  "information.text_actions_hint",
  "information.size_available",
  "information.size_unavailable",
  "information.sizes_available",
  "information.color_available",
  "information.color_unavailable",
  "information.colors_available",
  "information.size_owner_fallback",
  "information.color_owner_fallback",
  "sales.price_unknown",
  "sales.price",
  "sales.price_with_offer",
  "sales.greeting_unknown_product",
  "sales.greeting_with_price",
  "sales.greeting_product_only",
  "sales.recommendation_two_hints",
  "sales.recommendation_one_hint",
  "sales.recommendation_two_colors",
  "sales.recommendation_one_color",
  "sales.recommendation_generic",
  "sales.recommendation_product",
  "sales.recommendation_feature_details",
  "sales.recommendation_offer",
  "sales.recommendation_price",
  "sales.recommendation_more",
  "sales.identity_unknown",
  "sales.identity_with_details",
  "sales.identity_category",
  "sales.identity_description",
  "sales.identity_basic",
  "sales.detail_price",
  "sales.detail_colors",
  "sales.detail_sizes",
  "sales.detail_variants",
  "sales.detail_features",
  "sales.detail_offer",
  "sales.delivery_payment_both",
  "sales.delivery_only",
  "sales.payment_only",
  "sales.delivery_payment_unknown",
  "sales.images_unknown",
  "sales.images_available",
  "sales.order_default",
  "sales.order_fields",
  "order.offer_prompt",
  "order.quantity_prompt",
  "order.custom_quantity_prompt",
  "order.first_option_prompt",
  "order.first_size_prompt",
  "order.option_text_prompt",
  "order.item_option_prompt",
  "order.current_option_prompt",
  "order.item_quantity_prompt",
  "order.item_ready",
  "order.next_item_start",
  "order.ready_for_review",
  "order.piece_count_one",
  "order.piece_count_two",
  "order.piece_count_many",
  "order.planned_count_one",
  "order.planned_count_two",
  "order.planned_count_many",
  "order.item_label_first",
  "order.item_label_second",
  "order.item_label_third",
  "order.item_label_number",
  "order.selected_option_line",
  "order.piece_count_question_with_size",
  "order.first_item_progress_one",
  "order.first_item_progress_two",
  "order.first_item_progress_many",
  "order.initial_item_prompt_one",
  "order.initial_item_prompt_many",
  "order.completed_item",
  "order.next_item_same_or_different",
  "order.same_or_different_prompt",
  "order.different_second_item",
  "order.different_next_item",
  "order.same_as_previous_added",
  "order.cart_completion_one",
  "order.cart_completion_many",
  "order.cart_completion_short_one",
  "order.cart_completion_short_many",
  "cart.review_ready",
  "cart.select_item_to_edit",
  "cart.select_field_to_edit",
  "cart.quantity_edit",
  "cart.commercial_resolution_body",
  "cart.commercial_resolution_text",
  "cart.option_text_input",
  "cart.option_text_input_body",
  "cart.select_new_size",
  "cart.select_new_color",
  "cart.select_new_option",
  "cart.item_row_title",
  "cart.item_option_description",
  "cart.option_row",
  "cart.option_row_current",
  "cart.option_row_now",
  "cart.edit_option_label",
  "cart.edit_item_options",
  "delivery.grouped_request",
  "delivery.grouped_custom_request",
  "delivery.field_bullet",
  "delivery.field_prompt",
  "delivery.address_request",
  "delivery.saved_partial_invalid",
  "delivery.saved_partial",
  "delivery.edit_selector",
  "delivery.commercial_resolution",
  "checkout.final_review_intro",
  "checkout.delivery_section",
  "checkout.totals_section",
  "checkout.item_heading",
  "checkout.option_line",
  "checkout.delivery_line",
  "checkout.products_total",
  "checkout.delivery_free",
  "checkout.delivery_paid",
  "checkout.delivery_unspecified",
  "checkout.final_total",
  "checkout.confirmation_question",
  "order.confirmed_success",
  "order.already_confirmed",
  "error.invalid_selection",
  "error.stale_action",
  "error.recovery",
] as const;

export type ConversationMessageKey = (typeof CONVERSATION_MESSAGE_KEYS)[number];

export const CONVERSATION_LABEL_KEYS = [
  "first_entry.order_now",
  "first_entry.more_info",
  "first_entry.choice_title",
  "first_entry.payment_cod",
  "common.currency_mad",
  "common.product",
  "common.piece",
  "common.select",
  "common.enter",
  "information.price",
  "information.sizes",
  "information.colors",
  "information.delivery_payment",
  "information.how_to_order",
  "information.order_now",
  "information.start_order",
  "information.continue_order",
  "information.more",
  "information.product_title",
  "information.delivery_fields",
  "information.order_delivery_fields",
  "order.offers_title",
  "order.quantity_title",
  "order.size_list_button",
  "order.same_options",
  "order.different_options",
  "order.only_this",
  "order.add_one",
  "order.add_two",
  "cart.continue",
  "cart.add_item",
  "cart.edit",
  "cart.select_item_title",
  "cart.select_button",
  "cart.remove",
  "cart.use_standard",
  "cart.save",
  "cart.cancel",
  "cart.edit_options_title",
  "delivery.title",
  "delivery.full_name",
  "delivery.phone",
  "delivery.city",
  "delivery.address",
  "checkout.currency_mad",
  "checkout.confirm",
  "checkout.edit_order",
  "checkout.edit_delivery",
] as const;

export type ConversationLabelKey = (typeof CONVERSATION_LABEL_KEYS)[number];

declare const safeConversationFragmentBrand: unique symbol;

export type SafeConversationFragment = string & {
  readonly [safeConversationFragmentBrand]: true;
};

export type ConversationTemplateValue = string | number | boolean | SafeConversationFragment;

export type ConversationInteractionType = "text" | "buttons" | "list" | "split";

export type ConversationOutcomeReference = Readonly<{
  responseMessageKey?: ConversationMessageKey;
  nextPresentationKey?: ConversationMessageKey;
  domainActionKey?: string;
}>;

export type ConversationAction = Readonly<{
  id: string;
  label: string;
  value?: string;
  description?: string;
  outcome?: ConversationOutcomeReference;
}>;

export type ConversationListRow = ConversationAction & Readonly<{
  order: number;
  enabled: boolean;
  current?: boolean;
  available?: boolean;
}>;

export type ConversationPresentation = Readonly<{
  messageKey: ConversationMessageKey;
  locale: ConversationLocale;
  body: string;
  interactionType: ConversationInteractionType;
  title?: string;
  buttonText?: string;
  actions?: readonly ConversationAction[];
  rows?: readonly ConversationListRow[];
  fallbackText?: string;
  metadata?: Readonly<Record<string, string | number | boolean>>;
}>;
