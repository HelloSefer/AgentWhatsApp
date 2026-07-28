import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { WhatsAppConnectionCredentialEncryptionError } from "../domain/whatsapp-connection.errors";
import type { WhatsAppConnectionEncryptedTokenEnvelope } from "../domain/whatsapp-connection-credentials.types";
import type { WhatsAppConnectionCredentialEncryptionConfiguration } from "./whatsapp-connection-credential-encryption.config";

const IV_BYTES = 12;
const TAG_BYTES = 16;
const ENVELOPE_VERSION = 1;
const ENVELOPE_ALGORITHM = "AES-256-GCM";

function encode(value: Buffer): string {
  return value.toString("base64");
}

function decode(value: unknown): Buffer {
  if (typeof value !== "string" || !value.trim()) throw new WhatsAppConnectionCredentialEncryptionError();
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value.trim())) throw new WhatsAppConnectionCredentialEncryptionError();
  try {
    return Buffer.from(value, "base64");
  } catch {
    throw new WhatsAppConnectionCredentialEncryptionError();
  }
}

function parseEnvelope(serializedEnvelope: string): WhatsAppConnectionEncryptedTokenEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedEnvelope);
  } catch {
    throw new WhatsAppConnectionCredentialEncryptionError();
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !("v" in parsed) ||
    !("alg" in parsed) ||
    !("keyVersion" in parsed) ||
    !("iv" in parsed) ||
    !("ciphertext" in parsed) ||
    !("tag" in parsed)
  ) {
    throw new WhatsAppConnectionCredentialEncryptionError();
  }

  const envelope = parsed as Record<string, unknown>;
  if (
    envelope.v !== ENVELOPE_VERSION ||
    envelope.alg !== ENVELOPE_ALGORITHM ||
    typeof envelope.keyVersion !== "string" ||
    typeof envelope.iv !== "string" ||
    typeof envelope.ciphertext !== "string" ||
    typeof envelope.tag !== "string"
  ) {
    throw new WhatsAppConnectionCredentialEncryptionError();
  }

  return {
    v: ENVELOPE_VERSION,
    alg: ENVELOPE_ALGORITHM,
    keyVersion: envelope.keyVersion,
    iv: String(envelope.iv),
    ciphertext: String(envelope.ciphertext),
    tag: String(envelope.tag),
  };
}

export class WhatsAppConnectionCredentialEncryptionService {
  constructor(private readonly configuration: WhatsAppConnectionCredentialEncryptionConfiguration) {}

  encryptAccessToken(accessToken: string): { encryptedAccessToken: string; tokenKeyVersion: string; tokenFingerprint: string } {
    const encrypted = this.encryptSecret(accessToken, "access-token");
    return {
      encryptedAccessToken: encrypted.encryptedSecret,
      tokenKeyVersion: encrypted.keyVersion,
      tokenFingerprint: this.fingerprintAccessToken(accessToken),
    };
  }

  decryptAccessToken(encryptedAccessToken: string): string {
    return this.decryptSecret(encryptedAccessToken);
  }

  fingerprintAccessToken(accessToken: string): string {
    return this.fingerprintSecret(accessToken, "access-token");
  }

  encryptRegistrationPin(registrationPin: string): { encryptedRegistrationPin: string; registrationPinKeyVersion: string; registrationPinFingerprint: string } {
    const encrypted = this.encryptSecret(registrationPin, "registration-pin");
    return {
      encryptedRegistrationPin: encrypted.encryptedSecret,
      registrationPinKeyVersion: encrypted.keyVersion,
      registrationPinFingerprint: this.fingerprintRegistrationPin(registrationPin),
    };
  }

  decryptRegistrationPin(encryptedRegistrationPin: string): string {
    return this.decryptSecret(encryptedRegistrationPin);
  }

  fingerprintRegistrationPin(registrationPin: string): string {
    return this.fingerprintSecret(registrationPin, "registration-pin");
  }

  encryptedTokensMatch(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }

  private encryptSecret(secret: string, purpose: "access-token" | "registration-pin"): { encryptedSecret: string; keyVersion: string } {
    if (typeof secret !== "string" || !secret) throw new WhatsAppConnectionCredentialEncryptionError();
    const key = this.configuration.keys.get(this.configuration.activeKeyVersion);
    if (!key || key.length !== 32) throw new WhatsAppConnectionCredentialEncryptionError();

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const envelope: WhatsAppConnectionEncryptedTokenEnvelope = {
      v: ENVELOPE_VERSION,
      alg: ENVELOPE_ALGORITHM,
      keyVersion: this.configuration.activeKeyVersion,
      iv: encode(iv),
      ciphertext: encode(ciphertext),
      tag: encode(tag),
    };

    return {
      encryptedSecret: JSON.stringify(envelope),
      keyVersion: this.configuration.activeKeyVersion,
    };
  }

  private decryptSecret(encryptedSecret: string): string {
    const envelope = parseEnvelope(encryptedSecret);
    const key = this.configuration.keys.get(envelope.keyVersion);
    if (!key || key.length !== 32) throw new WhatsAppConnectionCredentialEncryptionError();

    const iv = decode(envelope.iv);
    const ciphertext = decode(envelope.ciphertext);
    const tag = decode(envelope.tag);
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ciphertext.length < 1) {
      throw new WhatsAppConnectionCredentialEncryptionError();
    }

    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch (error) {
      throw new WhatsAppConnectionCredentialEncryptionError(error);
    }
  }

  private fingerprintSecret(secret: string, purpose: "access-token" | "registration-pin"): string {
    if (typeof secret !== "string" || !secret) throw new WhatsAppConnectionCredentialEncryptionError();
    const key = this.configuration.keys.get(this.configuration.activeKeyVersion);
    if (!key || key.length !== 32) throw new WhatsAppConnectionCredentialEncryptionError();
    if (purpose === "access-token") {
      return `hmac-sha256:${createHmac("sha256", key).update(secret, "utf8").digest("hex")}`;
    }
    return `hmac-sha256:${purpose}:${createHmac("sha256", key).update(purpose, "utf8").update("\0", "utf8").update(secret, "utf8").digest("hex")}`;
  }
}
