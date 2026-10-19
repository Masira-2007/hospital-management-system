import { Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { importPKCS8, SignJWT } from "jose";
import * as oidc from "openid-client";

export type OAuthProvider = "google" | "apple";
export type VerifiedOAuthIdentity = { subject: string; email: string };

@Injectable()
export class OidcClientService {
  isConfigured(provider: OAuthProvider): boolean {
    if (provider === "google") return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    return Boolean(process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY);
  }

  async createAuthorizationUrl(provider: OAuthProvider, input: {
    state: string; nonce: string; codeChallenge: string;
  }): Promise<string> {
    const config = await this.getConfiguration(provider);
    const callback = this.callbackUrl(provider);
    const authorizationUrl = oidc.buildAuthorizationUrl(config, {
      redirect_uri: callback,
      response_type: "code",
      scope: provider === "google" ? "openid email profile" : "openid email",
      state: input.state,
      nonce: input.nonce,
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
      ...(provider === "apple" ? { response_mode: "form_post" } : {}),
      ...(provider === "google" ? { prompt: "select_account" } : {}),
    });
    return authorizationUrl.href;
  }

  async verifyAuthorizationCode(provider: OAuthProvider, input: {
    code: string; state: string; nonce: string; codeVerifier: string;
  }): Promise<VerifiedOAuthIdentity> {
    try {
      const config = await this.getConfiguration(provider);
      const callbackUrl = new URL(this.callbackUrl(provider));
      callbackUrl.searchParams.set("code", input.code);
      callbackUrl.searchParams.set("state", input.state);
      const tokenSet = await oidc.authorizationCodeGrant(config, callbackUrl, {
        expectedState: input.state,
        expectedNonce: input.nonce,
        pkceCodeVerifier: input.codeVerifier,
        idTokenExpected: true,
      });
      const claims = tokenSet.claims() as Record<string, unknown> | undefined;
      const subject = claims?.sub;
      const email = claims?.email;
      const verified = claims?.email_verified;
      if (typeof subject !== "string" || !subject || typeof email !== "string" || !email || !(verified === true || verified === "true")) {
        throw new UnauthorizedException("Sign-in could not be verified.");
      }
      return { subject, email: email.trim().toLowerCase() };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException("Sign-in could not be verified.");
    }
  }

  private callbackUrl(provider: OAuthProvider): string {
    const configured = process.env.APP_URL;
    let appUrl: URL;
    try {
      appUrl = new URL(configured ?? "http://localhost:3000");
    } catch {
      throw new ServiceUnavailableException("External sign-in is not configured.");
    }
    if (appUrl.username || appUrl.password || appUrl.search || appUrl.hash || (process.env.NODE_ENV === "production" && appUrl.protocol !== "https:")) {
      throw new ServiceUnavailableException("External sign-in is not configured.");
    }
    return new URL(`/api/auth/oauth/${provider}/callback`, appUrl).toString();
  }

  private async getConfiguration(provider: OAuthProvider): Promise<oidc.Configuration> {
    if (!this.isConfigured(provider)) throw new ServiceUnavailableException({
      code: "OAUTH_PROVIDER_NOT_CONFIGURED",
      message: `${provider === "google" ? "Google" : "Apple"} sign-in is not configured yet. Contact the system administrator.`,
    });

    const callback = this.callbackUrl(provider);
    const issuer = provider === "google" ? "https://accounts.google.com" : "https://appleid.apple.com";
    if (provider === "google") {
      const clientId = process.env.GOOGLE_CLIENT_ID!;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
      return oidc.discovery(new URL(issuer), clientId, {
        client_secret: clientSecret,
        redirect_uris: [callback],
      }, oidc.ClientSecretPost(clientSecret));
    }

    const clientId = process.env.APPLE_CLIENT_ID!;
    const teamId = process.env.APPLE_TEAM_ID!;
    const keyId = process.env.APPLE_KEY_ID!;
    const privateKeyPem = process.env.APPLE_PRIVATE_KEY!.replace(/\\n/g, "\n");
    let clientSecret: string;
    try {
      const signingKey = await importPKCS8(privateKeyPem, "ES256");
      const now = Math.floor(Date.now() / 1000);
      clientSecret = await new SignJWT({})
        .setProtectedHeader({ alg: "ES256", kid: keyId })
        .setIssuer(teamId)
        .setSubject(clientId)
        .setAudience(issuer)
        .setIssuedAt(now)
        .setExpirationTime(now + 5 * 60)
        .sign(signingKey);
    } catch {
      throw new ServiceUnavailableException("Apple sign-in is not configured correctly.");
    }
    return oidc.discovery(new URL(issuer), clientId, {
      client_secret: clientSecret,
      redirect_uris: [callback],
    }, oidc.ClientSecretPost(clientSecret));
  }
}
