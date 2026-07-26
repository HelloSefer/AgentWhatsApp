import { createTenantContext } from "../../../infrastructure/database";
import type { AuthRepositories } from "../contracts/auth.repository";
import { validateSellerMembershipSellerId } from "../domain/auth.validation";
import { isAuthPermission, roleHasPermission } from "../domain/authorization.policy";
import {
  AuthorizationInsufficientPermissionError,
  AuthorizationInvalidSellerTargetError,
  AuthorizationNoActiveMembershipError,
  AuthorizationTenantSelectionRequiredError,
  AuthorizationUnauthenticatedError,
} from "./authorization.errors";
import type { AuthorizationInput, AuthorizedTenantContext } from "./authorization.types";

export class AuthorizationService {
  constructor(private readonly repositories: AuthRepositories) {}

  async authorize(input: AuthorizationInput): Promise<AuthorizedTenantContext> {
    if (!input.principal) throw new AuthorizationUnauthenticatedError();
    if (!isAuthPermission(input.permission)) throw new AuthorizationInsufficientPermissionError();

    const activeMemberships = (await this.repositories.listSellerMembershipsForUser(input.principal.userId))
      .filter((membership) => membership.status === "active");
    if (activeMemberships.length === 0) throw new AuthorizationNoActiveMembershipError();

    const requestedSellerId = this.resolveRequestedSellerId(input.requestedSellerId, activeMemberships.map((membership) => membership.sellerId));
    const membership = activeMemberships.find((entry) => entry.sellerId === requestedSellerId);
    if (!membership) throw new AuthorizationInsufficientPermissionError();
    if (!roleHasPermission(membership.role, input.permission)) throw new AuthorizationInsufficientPermissionError();

    return {
      principal: input.principal,
      tenant: createTenantContext(membership.sellerId),
      sellerId: membership.sellerId,
      role: membership.role,
      permission: input.permission,
    };
  }

  private resolveRequestedSellerId(requestedSellerId: unknown, activeSellerIds: readonly string[]): string {
    if (requestedSellerId === undefined || requestedSellerId === null) {
      if (activeSellerIds.length === 1) return activeSellerIds[0]!;
      throw new AuthorizationTenantSelectionRequiredError();
    }

    try {
      return validateSellerMembershipSellerId(requestedSellerId);
    } catch {
      throw new AuthorizationInvalidSellerTargetError();
    }
  }
}
