/**
 * Generate a VAPID key pair for Web Push (P-256, web-push format).
 *
 *   npx tsx scripts/gen-vapid.ts            # print the keys
 *   npx tsx scripts/gen-vapid.ts --dev      # also add them to .dev.vars (local
 *                                           # only; keeps existing keys)
 *
 * Production: generate ONCE, then
 *   npx wrangler secret put VAPID_PUBLIC_KEY
 *   npx wrangler secret put VAPID_PRIVATE_KEY
 *   npx wrangler secret put VAPID_SUBJECT      # mailto:you@p2p.lk
 * Never rotate casually: every browser subscription is bound to the public
 * key, so a new key pair silently orphans every member's devices until each
 * one opens the app again (DEPLOY.md → Push notifications).
 */
import fs from "node:fs";
import path from "node:path";

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");
}

async function main() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKey = b64url(await crypto.subtle.exportKey("raw", pair.publicKey));
  const privateKey = (await crypto.subtle.exportKey("jwk", pair.privateKey)).d!;
  const lines = [`VAPID_PUBLIC_KEY=${publicKey}`, `VAPID_PRIVATE_KEY=${privateKey}`];

  if (!process.argv.includes("--dev")) {
    console.log(lines.join("\n"));
    console.log("VAPID_SUBJECT=mailto:you@example.com");
    return;
  }
  const file = path.resolve(process.cwd(), ".dev.vars");
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (/^VAPID_PRIVATE_KEY=.+$/m.test(current)) {
    console.log(".dev.vars already has VAPID keys — left unchanged (rotating them orphans local subscriptions).");
    return;
  }
  const add = [
    "",
    "# Web Push (dev keys from scripts/gen-vapid.ts — never use in production)",
    ...lines,
    /^VAPID_SUBJECT=/m.test(current) ? "" : "VAPID_SUBJECT=mailto:dev@p2p.lk.test",
    "",
  ].join("\n");
  fs.writeFileSync(file, current.replace(/\n*$/, "\n") + add.replace(/\n{3,}/g, "\n\n"));
  console.log(`Added VAPID dev keys to ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
