import type {
  ConversationLabelKey,
  ConversationMessageKey,
} from "../../contracts/conversation-presentation.types";
import { cartLabels, cartMessages } from "./cart.messages";
import { commonLabels } from "./common.messages";
import {
  deliveryCheckoutLabels,
  deliveryCheckoutMessages,
} from "./delivery-checkout.messages";
import { firstEntryLabels, firstEntryMessages } from "./first-entry.messages";
import { informationLabels, informationMessages } from "./information.messages";
import { orderLabels, orderMessages } from "./order.messages";
import { salesMessages } from "./sales.messages";

export const AR_MA_MESSAGES: Readonly<Record<ConversationMessageKey, string>> = {
  ...firstEntryMessages,
  ...informationMessages,
  ...salesMessages,
  ...orderMessages,
  ...cartMessages,
  ...deliveryCheckoutMessages,
};

export const AR_MA_LABELS: Readonly<Record<ConversationLabelKey, string>> = {
  ...commonLabels,
  ...firstEntryLabels,
  ...informationLabels,
  ...orderLabels,
  ...cartLabels,
  ...deliveryCheckoutLabels,
};
