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

  async sendHospitalApplicationVerification(recipient: string, token: string): Promise<void> {
    const url = this.publicUrl("/verify-email", token);
    await this.sendEmail({
      recipient,
      subject: "Verify your JR Xpert HMS hospital application email",
      text: `Use this one-time link to verify the official email for your hospital application. It expires in 24 hours.\n\n${url}\n\nIf you did not submit an application, ignore this email.`,
      html: `<p>Use this one-time link to verify the official email for your hospital application. It expires in 24 hours.</p><p><a href="${url}">Verify application email</a></p><p>If you did not submit an application, ignore this email.</p>`,
    });
  }

  async sendHospitalAdminInvitation(recipient: string, token: string): Promise<void> {
    const url = this.publicUrl("/accept-invitation", token);
    await this.sendEmail({
      recipient,
      subject: "You have a JR Xpert HMS hospital administrator invitation",
      text: `You were invited to set up a hospital administrator account. The one-time invitation expires in 72 hours.\n\n${url}\n\nYou will choose your own password and configure an authenticator app during setup.`,
      html: `<p>You were invited to set up a hospital administrator account. The one-time invitation expires in 72 hours.</p><p><a href="${url}">Accept invitation and secure your account</a></p><p>You will choose your own password and configure an authenticator app during setup.</p>`,
    });
  }

  async sendPlatformBootstrap(recipient: string, token: string): Promise<void> {
    const url = this.publicUrl("/platform/bootstrap", token);
    await this.sendEmail({
      recipient,
      subject: "Set up your JR Xpert HMS platform administrator account",
      text: `Use this one-time link to set your platform administrator password and enroll an authenticator. It expires in 30 minutes.\n\n${url}\n\nIf you did not initiate this setup, contact JR Xpert support immediately.`,
      html: `<p>Use this one-time link to set your platform administrator password and enroll an authenticator. It expires in 30 minutes.</p><p><a href="${url}">Secure your administrator account</a></p><p>If you did not initiate this setup, contact JR Xpert support immediately.</p>`,
    });
  }

  async sendApplicationDecision(recipient: string, decision: "REJECTED" | "NEEDS_INFORMATION", reason: string): Promise<void> {
    const safeReason = escapeHtml(reason);
    const subject = decision === "REJECTED" ? "Update about your JR Xpert HMS hospital application" : "More information is needed for your JR Xpert HMS application";
    const statusText = decision === "REJECTED" ? "Your hospital application was not approved." : "The JR Xpert HMS team needs more information before reviewing your hospital application.";
    await this.sendEmail({
      recipient,
      subject,
      text: `${statusText}\n\n${reason}`,
      html: `<p>${statusText}</p><p>${safeReason}</p>`,
    });
  }

  private publicUrl(path: string, token: string): string {
    const appUrl = process.env.APP_URL;
    if (!appUrl || !process.env.RESEND_API_KEY || !process.env.AUTH_EMAIL_FROM) {
      throw new ServiceUnavailableException("Email delivery is not configured.");
    }
    let origin: URL;
    try {
      origin = new URL(appUrl);
    } catch {
      throw new ServiceUnavailableException("Email delivery is not configured.");
    }
    if (origin.origin !== appUrl || (process.env.NODE_ENV === "production" && origin.protocol !== "https:")) {
      throw new ServiceUnavailableException("Email delivery is not configured.");
    }
    const url = new URL(path, origin);
    url.hash = new URLSearchParams({ token }).toString();
    return url.toString();
  }

  private async sendEmail({ recipient, subject, text, html }: { recipient: string; subject: string; text: string; html: string }): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.AUTH_EMAIL_FROM;
    if (!apiKey || !from) throw new ServiceUnavailableException("Email delivery is not configured.");
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 8_000);
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [recipient], subject, text, html }),
        signal: abort.signal,
      });
      if (!response.ok) throw new ServiceUnavailableException("Email delivery is unavailable.");
    } catch {
      throw new ServiceUnavailableException("Email delivery is unavailable.");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]!);
}
