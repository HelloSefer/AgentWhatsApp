type BufferedWhatsappMessage = {
  messages: string[];
  timer?: ReturnType<typeof setTimeout>;
  onFlush: (combinedText: string) => Promise<void>;
};

type BufferIncomingWhatsappMessageInput = {
  chatId: string;
  text: string;
  onFlush: (combinedText: string) => Promise<void>;
};

const FLUSH_DELAY_MS = 1500;
const MAX_PENDING_MESSAGES = 10;
const buffers = new Map<string, BufferedWhatsappMessage>();

async function flushBufferedMessages(chatId: string): Promise<void> {
  const buffer = buffers.get(chatId);

  if (!buffer) {
    return;
  }

  if (buffer.timer) {
    clearTimeout(buffer.timer);
    buffer.timer = undefined;
  }

  const messagesToFlush = buffer.messages.splice(0, MAX_PENDING_MESSAGES);

  if (!buffer.messages.length) {
    buffers.delete(chatId);
  } else {
    buffer.timer = setTimeout(() => {
      flushBufferedMessages(chatId).catch((error) => {
        console.error("❌ WhatsApp message buffer flush failed", error);
      });
    }, FLUSH_DELAY_MS);
  }

  const combinedText = messagesToFlush.join("\n").trim();

  if (!combinedText) {
    return;
  }

  try {
    await buffer.onFlush(combinedText);
  } catch (error) {
    console.error("❌ WhatsApp message buffer callback failed", error);
  }
}

export function bufferIncomingWhatsappMessage(
  input: BufferIncomingWhatsappMessageInput,
): void {
  const text = input.text.trim();

  if (!text) {
    return;
  }

  const existingBuffer = buffers.get(input.chatId);
  const buffer =
    existingBuffer ||
    ({
      messages: [],
      onFlush: input.onFlush,
    } satisfies BufferedWhatsappMessage);

  buffer.onFlush = input.onFlush;
  buffer.messages.push(text);
  buffers.set(input.chatId, buffer);

  if (buffer.timer) {
    clearTimeout(buffer.timer);
  }

  if (buffer.messages.length >= MAX_PENDING_MESSAGES) {
    flushBufferedMessages(input.chatId).catch((error) => {
      console.error("❌ WhatsApp message buffer flush failed", error);
    });
    return;
  }

  buffer.timer = setTimeout(() => {
    flushBufferedMessages(input.chatId).catch((error) => {
      console.error("❌ WhatsApp message buffer flush failed", error);
    });
  }, FLUSH_DELAY_MS);
}
