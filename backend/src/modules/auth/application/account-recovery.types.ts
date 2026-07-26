export type AccountRecoveryRequestResult = Readonly<{
  accepted: true;
}>;

export type AccountRecoveryConfirmResult = Readonly<{
  completed: true;
}>;

export type RequestEmailVerificationInput = Readonly<{
  email: unknown;
}>;

export type ConfirmEmailVerificationInput = Readonly<{
  token: unknown;
}>;

export type RequestPasswordResetInput = Readonly<{
  email: unknown;
}>;

export type ConfirmPasswordResetInput = Readonly<{
  token: unknown;
  newPassword: unknown;
}>;
