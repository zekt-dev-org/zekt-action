# zekt-action: Shield Hybrid Encryption — Implementation Brief

**For:** The AI agent / developer working in the `zekt-dev-org/zekt-action` repository  
**Context repo:** `zekt-dev-org/zektMainWeb` (Zekt backend + frontend)  
**Triggered by:** Bug — `shield: true` fails for any real-world payload with "Payload too large for RSA encryption"

---

## 1. Problem

The current action encrypts the entire JSON payload directly with RSA-OAEP:

```
ciphertext = RSA-OAEP-SHA256(payload_bytes, consumerPublicKey)
```

RSA is a key-transport primitive, not a bulk-encryption primitive. The maximum plaintext is determined by the key size minus OAEP overhead:

| Key size | Max plaintext (OAEP-SHA256) |
|---|---|
| RSA-2048 | ~190 bytes |
| RSA-4096 | ~446 bytes |

Any non-trivial payload (structured JSON with a few fields) exceeds 446 bytes and the action throws:

```
❌ Payload too large for RSA encryption (560 bytes). Maximum: ~190 bytes (2048-bit key)
   or ~446 bytes (4096-bit key). Reduce payload size or contact Zekt for hybrid encryption support.
```

This makes `shield: true` effectively unusable in practice.

---

## 2. Solution — Hybrid Encryption (AES-256-GCM + RSA-OAEP)

Replace direct RSA encryption with the standard KEM+DEM hybrid pattern:

1. Generate a random 32-byte AES key and 12-byte IV per dispatch.
2. Encrypt the payload **once** with AES-256-GCM → `ciphertext` + `authTag`. No size ceiling.
3. For **each consumer**, RSA-OAEP wrap the 32-byte AES key. The 32-byte key is always well under any RSA limit.
4. Emit a single envelope containing the shared ciphertext and a per-consumer map of wrapped keys.

No new action inputs are needed. The caller still uses only `payload` and `shield: true`.

---

## 3. Required Envelope Shape

The action **must** produce this exact JSON structure as the payload sent to the Zekt backend:

```json
{
  "type": "zekt-shield-envelope",
  "iv": "<standard base64, 12 bytes>",
  "authTag": "<standard base64, 16 bytes>",
  "ciphertext": "<standard base64 — AES-256-GCM ciphertext of the original payload>",
  "recipients": {
    "cust-000003": "<standard base64 — RSA-OAEP-SHA256 wrapped 32-byte AES key>",
    "cust-000007": "<standard base64 — same AES key, wrapped with a different consumer's public RSA key>"
  }
}
```

### Field details

| Field | Type | Notes |
|---|---|---|
| `type` | string | Must be exactly `"zekt-shield-envelope"` — the backend checks this marker |
| `iv` | string | Standard base64 (not base64url). 12 bytes → 16 base64 chars. |
| `authTag` | string | Standard base64. 16 bytes → 24 base64 chars. |
| `ciphertext` | string | Standard base64. AES-256-GCM encrypted UTF-8 JSON of the original payload. |
| `recipients` | object | Keys are Zekt customer IDs (e.g. `"cust-000003"`), returned by `/api/shield/keys`. Values are standard base64 RSA-OAEP-SHA256 wrapped AES key. |

**Use standard base64 throughout** (not base64url). Node's `Buffer.toString('base64')` and `Buffer.from(str, 'base64')` are correct.

---

## 4. Algorithm — Step by Step (Node.js)

```js
const crypto = require('crypto');

// consumerKeys = array of { consumerId: "cust-000003", publicKey: "<PEM>" }
// returned by GET /api/shield/keys

function encryptShieldEnvelope(payloadJson, consumerKeys) {
  // 1. Generate ephemeral AES-256 key and 12-byte IV
  const aesKey = crypto.randomBytes(32);
  const iv     = crypto.randomBytes(12);

  // 2. Encrypt payload once with AES-256-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(payloadJson, 'utf8')),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag(); // 16 bytes

  // 3. Wrap the AES key for each consumer with RSA-OAEP-SHA256
  const recipients = {};
  for (const { consumerId, publicKey } of consumerKeys) {
    recipients[consumerId] = crypto.publicEncrypt(
      { key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      aesKey
    ).toString('base64');
  }

  return {
    type: 'zekt-shield-envelope',
    iv:         iv.toString('base64'),
    authTag:    authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    recipients
  };
}
```

---

## 5. Backend Contract (No Changes Required)

The backend (`EventReceiverFunction.cs`) is zero-knowledge and only inspects the `type` marker:

```csharp
if (eventRequest.Payload.Value.TryGetProperty("type", out var typeProp) &&
    typeProp.GetString() == "zekt-shield-envelope")
{
    hasShieldEnvelope = true;
}
```

This check passes unchanged with the new envelope because `type` is still `"zekt-shield-envelope"`. The backend never decrypts; it stores and routes the opaque blob.

**The `/api/shield/keys` response shape is also unchanged.** It returns:

```json
{
  "keys": [
    { "consumerId": "cust-000003", "publicKey": "-----BEGIN PUBLIC KEY-----\n..." },
    { "consumerId": "cust-000007", "publicKey": "-----BEGIN PUBLIC KEY-----\n..." }
  ]
}
```

---

## 6. Error Handling

- If `/api/shield/keys` returns zero keys, fail the step clearly: no consumers have uploaded a public key, so encryption is impossible.
- If RSA wrapping fails for one consumer (malformed key), fail the step and surface the consumer ID — do not silently skip. Partial encryption would leave some consumers unable to decrypt.
- Remove or update the old "Payload too large for RSA encryption" error message and the "contact Zekt for hybrid encryption support" hint — both are now obsolete.

---

## 7. Consumer Decrypt Reference

For validation and documentation purposes, here are the canonical decrypt implementations consumers will use. The action itself does not decrypt; these are provided for completeness.

### Node.js

```js
// GitHub secrets: ZEKT_SHIELD_PRIVATE_KEY (PEM), ZEKT_CONSUMER_ID (e.g. "cust-000003"), ZEKT_PAYLOAD (envelope JSON)
const crypto   = require('crypto');
const envelope = JSON.parse(process.env.ZEKT_PAYLOAD);

const aesKey = crypto.privateDecrypt(
  { key: process.env.ZEKT_SHIELD_PRIVATE_KEY,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256' },
  Buffer.from(envelope.recipients[process.env.ZEKT_CONSUMER_ID], 'base64')
);

const decipher = crypto.createDecipheriv(
  'aes-256-gcm', aesKey, Buffer.from(envelope.iv, 'base64')
);
decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
const plaintext = Buffer.concat([
  decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
  decipher.final()
]).toString('utf8');
console.log(JSON.parse(plaintext));
```

### PowerShell (requires openssl CLI + .NET 8)

```powershell
# GitHub secrets: ZEKT_SHIELD_PRIVATE_KEY, ZEKT_CONSUMER_ID, ZEKT_PAYLOAD
$envelope  = $env:ZEKT_PAYLOAD | ConvertFrom-Json
$privFile  = [IO.Path]::GetTempFileName()
$wrapFile  = [IO.Path]::GetTempFileName()
$keyFile   = [IO.Path]::GetTempFileName()

$env:ZEKT_SHIELD_PRIVATE_KEY | Set-Content -Path $privFile -NoNewline
[IO.File]::WriteAllBytes($wrapFile,
  [Convert]::FromBase64String($envelope.recipients.($env:ZEKT_CONSUMER_ID)))

openssl pkeyutl -decrypt -inkey $privFile `
  -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 `
  -in $wrapFile -out $keyFile

$aesKey     = [IO.File]::ReadAllBytes($keyFile)
Remove-Item $privFile, $wrapFile, $keyFile

$ciphertext = [Convert]::FromBase64String($envelope.ciphertext)
$plain      = New-Object byte[] $ciphertext.Length
$aesGcm     = [System.Security.Cryptography.AesGcm]::new($aesKey, 16)
$aesGcm.Decrypt(
  [Convert]::FromBase64String($envelope.iv),
  $ciphertext,
  [Convert]::FromBase64String($envelope.authTag),
  $plain)
$aesGcm.Dispose()
Write-Host ([System.Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json | ConvertTo-Json -Depth 10)
```

---

## 8. No Backwards Compatibility Required

There are no live production users of the old direct-RSA envelope. The change is a hard cutover — no dual-support window is needed.

---

## 9. Summary of Changes in `zekt-action`

| Area | Change |
|---|---|
| Encryption logic | Replace `RSA-OAEP(payload)` with `AES-256-GCM(payload)` + `RSA-OAEP(aesKey)` per consumer |
| Envelope shape | Emit `{ type, iv, authTag, ciphertext, recipients }` as described in section 3 |
| Error messages | Remove the "Payload too large for RSA" and "contact Zekt for hybrid encryption support" messages |
| Inputs (`action.yml`) | No changes — `payload` and `shield: true` are sufficient |
| Backend API calls | No changes — `/api/shield/keys` request/response shape is unchanged |
