import { env } from "../../../config/env";
import { WhatsAppConnectionCredentialEncryptionError } from "../domain/whatsapp-connection.errors";

export type WhatsAppConnectionCredentialEncryptionConfigurationInput = Readonly<{
  activeKeyVersion?: string;
  keysJson?: string;
}>;

export type WhatsAppConnectionCredentialEncryptionConfiguration = Readonly<{
  activeKeyVersion: string;
  keys: ReadonlyMap<string, Buffer>;
}>;

function decodeKey(value: unknown): Buffer {
  if (typeof value !== "string" || !value.trim()) throw new WhatsAppConnectionCredentialEncryptionError();
  const encoded = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) throw new WhatsAppConnectionCredentialEncryptionError();
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new WhatsAppConnectionCredentialEncryptionError();
  return key;
}

export function validateWhatsAppConnectionCredentialEncryptionConfiguration(
  input: WhatsAppConnectionCredentialEncryptionConfigurationInput,
): WhatsAppConnectionCredentialEncryptionConfiguration {
  const activeKeyVersion = input.activeKeyVersion?.trim();
  if (!activeKeyVersion) throw new WhatsAppConnectionCredentialEncryptionError();

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.keysJson ?? "");
  } catch {
    throw new WhatsAppConnectionCredentialEncryptionError();
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new WhatsAppConnectionCredentialEncryptionError();
  }

  const keys = new Map<string, Buffer>();
  for (const [version, encodedKey] of Object.entries(parsed)) {
    const normalizedVersion = version.trim();
    if (!normalizedVersion) throw new WhatsAppConnectionCredentialEncryptionError();
    keys.set(normalizedVersion, decodeKey(encodedKey));
  }

  if (!keys.has(activeKeyVersion)) throw new WhatsAppConnectionCredentialEncryptionError();
  return Object.freeze({ activeKeyVersion, keys });
}

export function getWhatsAppConnectionCredentialEncryptionConfiguration(): WhatsAppConnectionCredentialEncryptionConfiguration {
  return validateWhatsAppConnectionCredentialEncryptionConfiguration({
    activeKeyVersion: env.whatsappConnectionTokenActiveKeyVersion,
    keysJson: env.whatsappConnectionTokenEncryptionKeysJson,
  });
}
