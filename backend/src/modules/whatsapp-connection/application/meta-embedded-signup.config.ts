import { env } from "../../../config/env";
import { WhatsAppConnectionMetaConfigurationError } from "../domain/whatsapp-connection.errors";

export type MetaEmbeddedSignupConfigurationInput = Readonly<{
  appId?: string;
  appSecret?: string;
  graphApiVersion?: string;
}>;

export type MetaEmbeddedSignupConfiguration = Readonly<{
  appId: string;
  appSecret: string;
  graphApiVersion: string;
}>;

function required(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 256) throw new WhatsAppConnectionMetaConfigurationError();
  return trimmed;
}

export function validateMetaEmbeddedSignupConfiguration(input: MetaEmbeddedSignupConfigurationInput): MetaEmbeddedSignupConfiguration {
  return Object.freeze({
    appId: required(input.appId),
    appSecret: required(input.appSecret),
    graphApiVersion: required(input.graphApiVersion),
  });
}

export function getMetaEmbeddedSignupConfiguration(): MetaEmbeddedSignupConfiguration {
  return validateMetaEmbeddedSignupConfiguration({
    appId: env.metaAppId,
    appSecret: env.metaAppSecret,
    graphApiVersion: env.metaGraphApiVersion,
  });
}
