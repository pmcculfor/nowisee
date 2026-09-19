import { describe, expect, it, vi } from "vitest";
import { mailerFromEnv, otpPepperFromEnv, parseOtpPepper } from "../server/mail/fromEnv.ts";
import { createResendMailer } from "../server/mail/resend.ts";

describe("mailer", () => {
  it("requires from and api key", () => {
    expect(() => mailerFromEnv({ env: {} })).toThrow(/NOWISEE_RESEND_API_KEY/);
    expect(() => mailerFromEnv({ env: { NOWISEE_RESEND_API_KEY: "re_test" } })).toThrow(
      /NOWISEE_MAIL_FROM/,
    );
  });

  it("otp pepper must be 32 bytes base64", () => {
    expect(() => parseOtpPepper("dG9vLXNob3J0")).toThrow(/32 bytes/);
  });

  it("otp pepper is required; there is no dev default", () => {
    expect(() => otpPepperFromEnv({ env: {} })).toThrow(/NOWISEE_OTP_PEPPER/);
    const pepper = otpPepperFromEnv({
      env: { NOWISEE_OTP_PEPPER: Buffer.alloc(32, 7).toString("base64") },
    });
    expect(pepper.byteLength).toBe(32);
  });

  it("Resend mailer posts JSON to the API", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const mailer = createResendMailer({
      apiKey: "re_test",
      from: "Now I See <login@nowisee.example>",
      fetch: fetchImpl,
    });
    await mailer.send({
      to: "ada@example.com",
      subject: "Your Now I See sign-in code",
      text: "kfm472",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer re_test",
    });
    const body = JSON.parse(String(init?.body)) as {
      from: string;
      to: string[];
      text: string;
    };
    expect(body.from).toContain("login@nowisee.example");
    expect(body.to).toEqual(["ada@example.com"]);
    expect(body.text).toBe("kfm472");
  });
});
