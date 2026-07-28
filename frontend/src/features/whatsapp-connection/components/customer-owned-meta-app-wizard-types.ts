import type { CurrentWhatsAppConnection, DiscoveredWhatsAppPhone } from "../services/embedded-signup-completion-service";

export const whatsappConnectionQueryKey = ["whatsapp-connection", "current"] as const;

export type WizardStep = "prepare" | "credentials" | "number" | "connection";
export type FinalizeStage = "idle" | "configuring" | "configured" | "finalizing" | "done" | "error";

export type CustomerOwnedMetaAppWizardMode = "new" | "replace" | "resume";

export type CustomerOwnedMetaAppWizardProps = Readonly<{
  initialConnection: CurrentWhatsAppConnection | null;
  mode?: CustomerOwnedMetaAppWizardMode;
  selectedPhoneFromStatus?: Pick<DiscoveredWhatsAppPhone, "maskedPhoneNumber" | "verifiedName"> | null;
  onDone: () => void | Promise<void>;
  onCancel?: () => void;
}>;

export type CredentialsForm = Readonly<{
  appId: string;
  appSecret: string;
  systemUserAccessToken: string;
}>;

export type SelectedConnectionSummary = Readonly<{
  maskedPhoneNumber: string | null;
  verifiedName: string | null;
}>;

export const EMPTY_CREDENTIALS: CredentialsForm = {
  appId: "",
  appSecret: "",
  systemUserAccessToken: "",
};
