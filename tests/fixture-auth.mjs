import {generateKeyPair, exportSPKI, SignJWT} from "jose";

export const DOMAIN = "clerk-fixture.example";

export async function fixtureAuth(origin) {
  const {publicKey, privateKey} = await generateKeyPair("RS256", {extractable: true});
  const env = {
    CLERK_PUBLISHABLE_KEY: "pk_test_" + Buffer.from(DOMAIN + "$").toString("base64url"),
    CLERK_JWT_KEY: (await exportSPKI(publicKey)).trim().replaceAll("\n", "\\n"),
    APP_ORIGIN: origin,
  };
  async function sign(sub, overrides = {}) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      sub, sid: "sess_" + sub, iss: "https://" + DOMAIN, azp: origin,
      iat: now, nbf: now - 1, exp: now + 1800, ...overrides,
    }).setProtectedHeader({alg: "RS256"}).sign(privateKey);
  }
  return {env, sign};
}
