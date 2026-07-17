import assert from "node:assert/strict";
import { env } from "../../src/config/env";
import {
  activateTypingIndicator,
  applyReplyPacing,
} from "../../src/modules/whatsapp/cloud/whatsapp-cloud-typing-indicator.service";

async function run() {
  const original = {
    enabled: env.whatsappTypingIndicatorEnabled,
    timeout: env.whatsappTypingRequestTimeoutMs,
    minimum: env.whatsappTypingMinDelayMs,
    maximum: env.whatsappTypingMaxDelayMs,
  };

  try {
    let capturedPayload: unknown;
    const displayed = await activateTypingIndicator({
      messageId: "wamid.unit.typing.001",
      phoneNumberId: "unit-phone-number-id",
      messageType: "text",
      transport: async (_phoneNumberId, payload) => {
        capturedPayload = payload;
        return { success: true, dryRun: true };
      },
    });
    assert.equal(displayed.attempted, true);
    assert.equal(displayed.displayed, true);
    assert.deepEqual(capturedPayload, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.unit.typing.001",
      typing_indicator: { type: "text" },
    });

    const missingId = await activateTypingIndicator({
      phoneNumberId: "unit-phone-number-id",
      transport: async () => ({ success: true, dryRun: true }),
    });
    assert.equal(missingId.skippedReason, "missing_message_id");
    assert.equal(missingId.attempted, false);

    const guardBlocked = await activateTypingIndicator({
      messageId: "wamid.unit.typing.blocked",
      phoneNumberId: "unit-phone-number-id",
      guardBlocked: true,
      transport: async () => {
        throw new Error("Guard-blocked typing must not call transport");
      },
    });
    assert.equal(guardBlocked.skippedReason, "guard_blocked");
    assert.equal(guardBlocked.attempted, false);

    const graphFailure = await activateTypingIndicator({
      messageId: "wamid.unit.typing.002",
      phoneNumberId: "unit-phone-number-id",
      transport: async () => ({ success: false, dryRun: false, errorMessage: "Graph error" }),
    });
    assert.equal(graphFailure.failureCategory, "graph_error");

    env.whatsappTypingRequestTimeoutMs = 10;
    const timedOut = await activateTypingIndicator({
      messageId: "wamid.unit.typing.003",
      phoneNumberId: "unit-phone-number-id",
      transport: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { success: true, dryRun: false };
      },
    });
    assert.equal(timedOut.failureCategory, "timeout");

    env.whatsappTypingIndicatorEnabled = false;
    const disabled = await activateTypingIndicator({
      messageId: "wamid.unit.typing.004",
      phoneNumberId: "unit-phone-number-id",
      transport: async () => ({ success: true, dryRun: true }),
    });
    assert.equal(disabled.skippedReason, "disabled");

    env.whatsappTypingIndicatorEnabled = true;
    env.whatsappTypingMinDelayMs = 5;
    env.whatsappTypingMaxDelayMs = 12;
    const pacingStartedAt = Date.now();
    const pacingDelayMs = await applyReplyPacing({
      replyText: "test",
      processingDurationMs: 0,
    });
    const pacingElapsedMs = Date.now() - pacingStartedAt;
    assert.ok(pacingDelayMs >= 5 && pacingDelayMs <= 12);
    assert.ok(pacingElapsedMs >= 4 && pacingElapsedMs <= 40);

    console.log("Typing indicator unit checks passed: payload, skip, graph failure, timeout, disabled, pacing.");
  } finally {
    env.whatsappTypingIndicatorEnabled = original.enabled;
    env.whatsappTypingRequestTimeoutMs = original.timeout;
    env.whatsappTypingMinDelayMs = original.minimum;
    env.whatsappTypingMaxDelayMs = original.maximum;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
