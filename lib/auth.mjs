import {importSPKI, jwtVerify} from "jose";

let key;

export function publicConfig(env = process.env) {
  const publishableKey = env.CLERK_PUBLISHABLE_KEY || "";
  const encoded = /^pk_(?:test|live)_([a-zA-Z0-9_-]+)$/.exec(publishableKey)?.[1];
  const domain = encoded && Buffer.from(encoded, "base64url").toString("utf8");
  if (!domain || !/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+\$$/.test(domain)) {
    throw new Error("Set CLERK_PUBLISHABLE_KEY in .env to your Clerk Publishable Key.");
  }
  return {publishableKey, clerkDomain: domain.slice(0, -1)};
}

export async function sessionOwner(request, env = process.env) {
  const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get("Authorization") || "")?.[1];
  if (!token || token.length > 8192) return null;
  const {clerkDomain} = publicConfig(env);
  const pem = env.CLERK_JWT_KEY?.replaceAll("\\n", "\n");
  if (!pem) throw new Error("Set CLERK_JWT_KEY in .env.");
  if (key?.pem !== pem) key = {pem, value: importSPKI(pem, "RS256")};
  const publicKey = await key.value;
  const origin = (env.APP_ORIGIN || "http://localhost:3000").replace(/\/$/, "");
  try {
    const {payload} = await jwtVerify(token, publicKey, {
      issuer: "https://" + clerkDomain, algorithms: ["RS256"], clockTolerance: 5,
      requiredClaims: ["sub", "sid", "iss", "azp", "exp", "iat", "nbf"],
    });
    if (payload.azp !== origin || (payload.sts && payload.sts !== "active") ||
        typeof payload.sub !== "string" || !payload.sub ||
        typeof payload.sid !== "string" || !payload.sid) return null;
    return payload.sub;
  } catch {
    return null;
  }
}
