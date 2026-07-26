export type AuthEmailVerificationMessage = Readonly<{
  emailNormalized: string;
  verificationToken: string;
  expiresAt: Date;
}>;

export type AuthPasswordResetMessage = Readonly<{
  emailNormalized: string;
  resetToken: string;
  expiresAt: Date;
}>;

export interface AuthEmailSender {
  sendEmailVerification(message: AuthEmailVerificationMessage): Promise<void>;
  sendPasswordReset(message: AuthPasswordResetMessage): Promise<void>;
}
