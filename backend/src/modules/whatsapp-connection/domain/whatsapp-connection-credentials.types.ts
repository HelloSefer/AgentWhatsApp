export type WhatsAppConnectionEncryptedTokenEnvelope = Readonly<{
  v: 1;
  alg: "AES-256-GCM";
  keyVersion: string;
  iv: string;
  ciphertext: string;
  tag: string;
}>;

export type WhatsAppConnectionCredentialStorage = Readonly<{
  connectionId: string;
  sellerId: string;
  encryptedAccessToken: string;
  tokenKeyVersion: string;
  tokenFingerprint: string;
  tokenExpiresAt?: Date;
}>;

export type WhatsAppConnectionRegistrationPinStorage = Readonly<{
  connectionId: string;
  sellerId: string;
  encryptedRegistrationPin: string;
  registrationPinKeyVersion: string;
  registrationPinFingerprint: string;
}>;

export type PersistWhatsAppConnectionCredentialInput = Readonly<{
  encryptedAccessToken: string;
  tokenKeyVersion: string;
  tokenFingerprint: string;
  tokenExpiresAt?: Date | null;
}>;

export type PersistWhatsAppConnectionRegistrationPinInput = Readonly<{
  encryptedRegistrationPin: string;
  registrationPinKeyVersion: string;
  registrationPinFingerprint: string;
}>;

export type StoreWhatsAppConnectionAccessTokenInput = Readonly<{
  accessToken: string;
  tokenExpiresAt?: Date | null;
}>;
