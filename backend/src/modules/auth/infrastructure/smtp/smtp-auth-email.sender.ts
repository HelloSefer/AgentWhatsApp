import nodemailer, { type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import type { AuthEmailSender, AuthEmailVerificationMessage, AuthPasswordResetMessage } from "../../contracts/auth-email.sender";

export type SmtpAuthEmailConfiguration = Readonly<{
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName: string;
  fromAddress: string;
  frontendBaseUrl: string;
  subjectPrefix?: string;
}>;

export class SmtpAuthEmailConfigurationError extends Error {
  constructor() {
    super("SMTP auth email configuration is unavailable.");
    this.name = "SmtpAuthEmailConfigurationError";
  }
}

type SmtpTransportFactory = (options: SMTPTransport.Options) => Transporter;

function requireConfiguration(config: SmtpAuthEmailConfiguration): void {
  if (
    !config.host ||
    !Number.isInteger(config.port) ||
    config.port <= 0 ||
    config.port > 65535 ||
    !config.user ||
    !config.password ||
    !config.fromName ||
    !config.fromAddress ||
    !config.frontendBaseUrl
  ) {
    throw new SmtpAuthEmailConfigurationError();
  }

  try {
    const frontendUrl = new URL(config.frontendBaseUrl);
    if (!["http:", "https:"].includes(frontendUrl.protocol)) throw new SmtpAuthEmailConfigurationError();
  } catch {
    throw new SmtpAuthEmailConfigurationError();
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function formatFrom(config: SmtpAuthEmailConfiguration): string {
  return `"${config.fromName.replace(/["\r\n]/gu, "")}" <${config.fromAddress}>`;
}

function buildFrontendLink(config: SmtpAuthEmailConfiguration, pathname: "/verify-email" | "/reset-password", token: string): string {
  const url = new URL(pathname, `${config.frontendBaseUrl}/`);
  url.searchParams.set("token", token);
  return url.toString();
}

function renderHtml(input: Readonly<{ title: string; intro: string; cta: string; link: string; expiresAt: Date }>): string {
  const link = escapeHtml(input.link);
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f6f8f7;color:#16211d;font-family:Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f8f7;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dce5df;border-radius:12px;padding:32px;">
            <tr><td>
              <p style="margin:0 0 12px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#1f7a4d;font-weight:700;">AgentWhatsApp</p>
              <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;color:#16211d;">${escapeHtml(input.title)}</h1>
              <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#4d5c55;">${escapeHtml(input.intro)}</p>
              <p style="margin:0 0 24px;">
                <a href="${link}" style="display:inline-block;border-radius:8px;background:#1f7a4d;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;">${escapeHtml(input.cta)}</a>
              </p>
              <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#66736c;">This link expires at ${escapeHtml(input.expiresAt.toISOString())}.</p>
              <p style="margin:0;font-size:13px;line-height:1.6;color:#66736c;">If the button does not work, copy and paste this link into your browser:<br><a href="${link}" style="color:#1f7a4d;word-break:break-all;">${link}</a></p>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderText(input: Readonly<{ title: string; intro: string; link: string; expiresAt: Date }>): string {
  return `${input.title}

${input.intro}

Open this link:
${input.link}

This link expires at ${input.expiresAt.toISOString()}.

If you did not request this, you can ignore this email.`;
}

export class SmtpAuthEmailSender implements AuthEmailSender {
  private transporter?: Transporter;

  constructor(
    private readonly config: SmtpAuthEmailConfiguration,
    private readonly transportFactory: SmtpTransportFactory = (options) => nodemailer.createTransport(options),
  ) {}

  private getTransporter(): Transporter {
    requireConfiguration(this.config);
    this.transporter ??= this.transportFactory({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: {
        user: this.config.user,
        pass: this.config.password,
      },
    });
    return this.transporter;
  }

  async verifyConnection(): Promise<void> {
    await this.getTransporter().verify();
  }

  async sendEmailVerification(message: AuthEmailVerificationMessage): Promise<void> {
    const transporter = this.getTransporter();
    const link = buildFrontendLink(this.config, "/verify-email", message.verificationToken);
    const subject = `${this.config.subjectPrefix ?? ""}Verify your AgentWhatsApp email`;
    await transporter.sendMail({
      from: formatFrom(this.config),
      to: message.emailNormalized,
      subject,
      text: renderText({
        title: subject,
        intro: "Confirm this email address to finish securing your AgentWhatsApp account.",
        link,
        expiresAt: message.expiresAt,
      }),
      html: renderHtml({
        title: subject,
        intro: "Confirm this email address to finish securing your AgentWhatsApp account.",
        cta: "Verify email",
        link,
        expiresAt: message.expiresAt,
      }),
    });
  }

  async sendPasswordReset(message: AuthPasswordResetMessage): Promise<void> {
    const transporter = this.getTransporter();
    const link = buildFrontendLink(this.config, "/reset-password", message.resetToken);
    const subject = `${this.config.subjectPrefix ?? ""}Reset your AgentWhatsApp password`;
    await transporter.sendMail({
      from: formatFrom(this.config),
      to: message.emailNormalized,
      subject,
      text: renderText({
        title: subject,
        intro: "Use this secure link to choose a new AgentWhatsApp password.",
        link,
        expiresAt: message.expiresAt,
      }),
      html: renderHtml({
        title: subject,
        intro: "Use this secure link to choose a new AgentWhatsApp password.",
        cta: "Reset password",
        link,
        expiresAt: message.expiresAt,
      }),
    });
  }
}
