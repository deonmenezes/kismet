// Points the Kismet WhatsApp number's webhook at a URL with a phone-number-level override_callback_uri,
// so the Meta app's own webhook (Deon's inbox receiver, deon-wa-webhook) is never changed.
//   node --env-file=.env.local scripts/whatsapp-webhook.mjs https://kismet-village.vercel.app/api/text/whatsapp
//   node --env-file=.env.local scripts/whatsapp-webhook.mjs --clear     # back to the app-level webhook
//   node --env-file=.env.local scripts/whatsapp-webhook.mjs             # show the current setting
// Meta calls GET <url>?hub.verify_token=... first, so the URL must already be deployed.
// Needs WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN (and WHATSAPP_API_VERSION).

const { WHATSAPP_ACCESS_TOKEN: token, WHATSAPP_PHONE_NUMBER_ID: phone, WHATSAPP_VERIFY_TOKEN: verify } = process.env;
const version = process.env.WHATSAPP_API_VERSION || "v23.0";
if (!token || !phone || !verify) throw new Error("Set WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_VERIFY_TOKEN");
const arg = process.argv[2];
const api = `https://graph.facebook.com/${version}/${phone}`;
if (arg) {
  const webhook_configuration = arg === "--clear" ? { override_callback_uri: "" } : { override_callback_uri: arg, verify_token: verify };
  const r = await fetch(api, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ webhook_configuration }) });
  console.log("set:", r.status, JSON.stringify(await r.json()));
}
const now = await (await fetch(`${api}?fields=webhook_configuration,display_phone_number`, { headers: { authorization: `Bearer ${token}` } })).json();
console.log("now:", JSON.stringify(now));
