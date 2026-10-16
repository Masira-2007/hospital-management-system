import { Injectable, ServiceUnavailableException } from "@nestjs/common";

const PASSWORD_RESET_NOT_CONFIGURED = {
  code: "PASSWORD_RECOVERY_NOT_CONFIGURED",
  message: "Password recovery is not configured. Contact your hospital administrator.",
};

@Injectable()
export class EmailDeliveryService {
  isConfigured(): boolean {
    return Boolean(process.env.RESEND_API_KEY && process.env.AUTH_EMAIL_FROM && process.env.APP_URL);
  }

  async sendPasswordReset(recipient: string, token: string): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.AUTH_EMAIL_FROM;
    const appUrl = process.env.APP_URL;
    if (!apiKey || !from || !appUrl) throw new ServiceUnavailableException(PASSWORD_RESET_NOT_CONFIGURED);

    let origin: URL;
    try {
      origin = new URL(appUrl);
    } catch {
      throw new ServiceUnavailableException(PASSWORD_RESET_NOT_CONFIGURED);
    }
    if (origin.origin !== appUrl || (process.env.NODE_ENV === "production" && origin.protocol !== "https:")) {
      throw new ServiceUnavailableException(PASSWORD_RESET_NOT_CONFIGURED);
    }

    const resetUrl = new URL("/reset-password", origin);
    resetUrl.hash = new URLSearchParams({ token }).toString();
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 8_000);
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [recipient],
          subject: "Reset your JR Xpert HMS password",
          text: `Use this one-time link to reset your JR Xpert HMS password. It expires in 20 minutes.\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
          html: `<p>Use this one-time link to reset your JR Xpert HMS password. It expires in 20 minutes.</p><p><a href="${resetUrl.toString()}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`,
        }),
        signal: abort.signal,
      });
      if (!response.ok) throw new ServiceUnavailableException("Password recovery email could not be delivered.");
    } catch {
      throw new ServiceUnavailableException("Password recovery email could not be delivered.");
    } finally {
      clearTimeout(timeout);
    }
  }
}
