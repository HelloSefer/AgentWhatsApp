import type { AuthPermission } from "../domain/authorization.policy";

export const SELLER_ROUTE_PERMISSIONS = Object.freeze({
  agentConfigRead: "conversation_config.read",
  agentConfigPreviewRead: "conversation_config.read",
  agentOrdersRead: "orders.read",
  agentOrdersManage: "orders.manage",
  agentAdminNotificationsRead: "orders.read",
  agentAdminNotificationsManage: "orders.manage",
  conversationConfigEffectiveRead: "conversation_config.read",
} satisfies Record<string, AuthPermission>);
