import qrcode from "qrcode-terminal";
import pino from "pino";

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
});

export async function startWhatsApp() {
  const baileys = await import("@whiskeysockets/baileys");

  const makeWASocket = baileys.default;
  const { DisconnectReason, useMultiFileAuthState } = baileys;

  const { state, saveCreds } = await useMultiFileAuthState("auth/whatsapp");

  const sock = makeWASocket({
    auth: state,
    logger: logger as any,
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\nScan this QR code with WhatsApp:\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ WhatsApp connected successfully");
    }

    if (connection === "close") {
      const shouldReconnect =
        (lastDisconnect?.error as any)?.output?.statusCode !==
        DisconnectReason.loggedOut;

      console.log("❌ WhatsApp connection closed");

      if (shouldReconnect) {
        console.log("🔄 Reconnecting to WhatsApp...");
        startWhatsApp();
      } else {
        console.log("🚪 Logged out from WhatsApp. Scan QR again.");
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const message = messages[0];

    if (!message.message || message.key.fromMe) {
      return;
    }

    const from = message.key.remoteJid;
    const text =
      message.message.conversation ||
      message.message.extendedTextMessage?.text ||
      "";

    console.log("📩 New message received");
    console.log("From:", from);
    console.log("Text:", text);

    if (!from || !text.trim()) {
      return;
    }

    await sock.sendMessage(from, {
      text: "سلام 👋انا  Agent تجريبي توصلت برسالتك بنجاح ،برعاية العزي sandouuula 😂😂",
    });

    console.log("✅ Test reply sent");
  });

  return sock;
}
