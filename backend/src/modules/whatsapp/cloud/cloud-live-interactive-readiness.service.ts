import { env } from "../../../config/env";

type ReadinessSeverity = "blocking" | "warning";

type ReadinessCheck = {
  key: string;
  passed: boolean;
  severity: ReadinessSeverity;
  requiredValue?: string;
  currentValue?: string;
  present?: boolean;
  maskedValue?: string;
  message?: string;
};

function maskSecret(value: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const suffix = value.slice(-4);

  return `****${suffix}`;
}

export function maskReadinessPhone(value: string): string | undefined {
  const digits = value.replace(/\D/g, "");

  if (!digits) {
    return undefined;
  }

  if (digits.length <= 6) {
    return "***";
  }

  return `${digits.slice(0, 3)}******${digits.slice(-3)}`;
}

function booleanCheck(input: {
  key: string;
  current: boolean;
  required: boolean;
  severity: ReadinessSeverity;
  message?: string;
}): ReadinessCheck {
  return {
    key: input.key,
    passed: input.current === input.required,
    severity: input.severity,
    requiredValue: String(input.required),
    currentValue: String(input.current),
    message: input.message,
  };
}

function presenceCheck(input: {
  key: string;
  value: string;
  severity: ReadinessSeverity;
  maskedValue?: string;
  message?: string;
}): ReadinessCheck {
  const present = Boolean(input.value.trim());

  return {
    key: input.key,
    passed: present,
    severity: input.severity,
    requiredValue: "present",
    present,
    ...(input.maskedValue ? { maskedValue: input.maskedValue } : {}),
    message: input.message,
  };
}

export function buildLiveInteractiveReadiness(input: {
  testRecipientPhone?: string;
  sellerId?: string;
}) {
  const testRecipientPhone = input.testRecipientPhone?.trim() || "";
  const sellerId = input.sellerId?.trim() || "";
  const checks: ReadinessCheck[] = [
    booleanCheck({
      key: "WHATSAPP_INTERACTIVE_ENABLED",
      current: env.whatsappInteractiveEnabled,
      required: true,
      severity: "blocking",
    }),
    booleanCheck({
      key: "WHATSAPP_INTERACTIVE_LIVE_SEND_ALLOWED",
      current: env.whatsappInteractiveLiveSendAllowed,
      required: true,
      severity: "blocking",
    }),
    booleanCheck({
      key: "WHATSAPP_CLOUD_DRY_RUN",
      current: env.whatsappCloudDryRun,
      required: false,
      severity: "blocking",
    }),
    presenceCheck({
      key: "WHATSAPP_CLOUD_ACCESS_TOKEN",
      value: env.whatsappCloudAccessToken,
      severity: "blocking",
      maskedValue: maskSecret(env.whatsappCloudAccessToken),
    }),
    presenceCheck({
      key: "WHATSAPP_CLOUD_PHONE_NUMBER_ID",
      value: env.whatsappCloudPhoneNumberId,
      severity: "blocking",
      maskedValue: maskSecret(env.whatsappCloudPhoneNumberId),
    }),
    presenceCheck({
      key: "TEST_RECIPIENT_PHONE",
      value: testRecipientPhone,
      severity: "blocking",
      maskedValue: maskReadinessPhone(testRecipientPhone),
      message: "Provide testRecipientPhone in the readiness request before a live smoke test.",
    }),
    presenceCheck({
      key: "WHATSAPP_CLOUD_API_VERSION",
      value: env.whatsappCloudApiVersion,
      severity: "blocking",
      message: "Cloud API version is required for send requests.",
    }),
  ];

  const warningChecks: ReadinessCheck[] = [
    presenceCheck({
      key: "PUBLIC_BASE_URL",
      value: env.publicBaseUrl,
      severity: "warning",
      message: "Public base URL/ngrok is useful for webhook and order-form testing.",
    }),
    {
      key: "SELLER_ID",
      passed: !sellerId.startsWith("seller_demo_"),
      severity: "warning",
      currentValue: sellerId || "not_provided",
      message: sellerId.startsWith("seller_demo_")
        ? "Demo seller selected for readiness check."
        : "Provide sellerId if the smoke test should target a specific seller.",
    },
    {
      key: "TEST_RECIPIENT_PHONE_PROVIDED",
      passed: Boolean(testRecipientPhone),
      severity: "warning",
      currentValue: testRecipientPhone
        ? maskReadinessPhone(testRecipientPhone)
        : "not_provided",
      message: "A recipient is needed before any live smoke test.",
    },
    {
      key: "LIVE_SEND_ARMED",
      passed: !(
        env.whatsappInteractiveLiveSendAllowed && !env.whatsappCloudDryRun
      ),
      severity: "warning",
      currentValue: `interactiveLiveSendAllowed=${env.whatsappInteractiveLiveSendAllowed}, cloudDryRun=${env.whatsappCloudDryRun}`,
      message:
        "Live interactive sending is armed when the live guard is true and dry-run is false.",
    },
  ];
  const allChecks = [...checks, ...warningChecks];
  const blockingCount = allChecks.filter(
    (check) => check.severity === "blocking" && !check.passed,
  ).length;
  const warningCount = allChecks.filter(
    (check) => check.severity === "warning" && !check.passed,
  ).length;

  return {
    readyForLiveInteractiveTest: blockingCount === 0,
    checks: allChecks,
    summary: {
      blockingCount,
      warningCount,
    },
    inputs: {
      testRecipientPhoneMasked: maskReadinessPhone(testRecipientPhone),
      sellerId: sellerId || undefined,
    },
    safety: {
      sendsMessages: false,
      callsMetaSendApi: false,
    },
  };
}
