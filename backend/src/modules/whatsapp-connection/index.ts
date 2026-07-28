export type {
  CreateWhatsAppConnectionCandidateInput,
  VerifiedWhatsAppConnectionMetadataInput,
  WhatsAppConnectionRepository,
  WhatsAppConnectionRepositoryOptions,
} from "./contracts/whatsapp-connection.repository";
export {
  WhatsAppConnectionActiveAlreadyExistsError,
  WhatsAppConnectionPersistenceError,
  WhatsAppConnectionPhoneNumberAlreadyAssignedError,
  WhatsAppConnectionSellerNotFoundError,
  WhatsAppConnectionValidationError,
} from "./domain/whatsapp-connection.errors";
export {
  WHATSAPP_CONNECTION_PROVIDER,
  WHATSAPP_CONNECTION_STATUSES,
  type ActiveWhatsAppConnectionResolution,
  type WhatsAppConnection,
  type WhatsAppConnectionProvider,
  type WhatsAppConnectionStatus,
} from "./domain/whatsapp-connection.types";
export { PostgreSqlWhatsAppConnectionRepository, postgreSqlWhatsAppConnectionRepository } from "./infrastructure/postgresql/postgresql-whatsapp-connection.repository";
