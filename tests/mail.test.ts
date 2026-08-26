import { describe, expect, it, vi } from "vitest";
import { mailerFromEnv, otpPepperFromEnv, parseOtpPepper } from "../server/mail/fromEnv.ts";
import { createResendMailer } from "../server/mail/resend.ts";

describe("mailer", () => {
  it("console driver is refused when origin is not localhost", () => {
    expect(() =>
      mailerFromEnv({
        configuredOrigin: "https://nowisee.example",
        env: { NOWISEE_MAIL_DRIVER: "console" },
      }),
    ).toThrow(/localhost/);
  });

  it("resend driver requires from and api key", () => {
    expect(() =>
      mailerFromEnv({
        configuredOrigin: "https://nowisee.example",
        env: { NOWISEE_MAIL_DRIVER: "resend" },
      }),
    ).toThrow(/NOWISEE_RESEND_API_KEY/);
  });

  it("otp pepper must be 32 bytes base64", () => {
    expect(() => parseOtpPepper("dG9vLXNob3J0")).toThrow(/32 bytes/);
  });

  it("Resend pepper is required; console may use a dev default", () => {
    expect(() => otpPepperFromEnv({ env: { NOWISEE_MAIL_DRIVER: "resend" } })).toThrow(
      /NOWISEE_OTP_PEPPER/,
    );
    const pepper = otpPepperFromEnv({ env: { NOWISEE_MAIL_DRIVER: "console" } });
    expect(pepper.byteLength).toBe(32);
  });

  it("Resend mailer posts JSON to the API", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const mailer = createResendMailer({
      apiKey: "re_test",
      from: "Now I See <login@nowisee.example>",
      fetch: fetchImpl as unknown as typeof fetch,
    });
    await mailer.send({
      to: "ada@example.com",
      subject: "Your Now I See sign-in code",
      text: "kfm472",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer re_test",
    });
    const body = JSON.parse(String((init as RequestInit).body)) as {
      from: string;
      to: string[];
      text: string;
    };
    expect(body.from).toContain("login@nowisee.example");
    expect(body.to).toEqual(["ada@example.com"]);
    expect(body.text).toBe("kfm472");
  });
});
