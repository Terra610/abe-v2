// engine/verify/verify.js
// Local-only SHA-256 verification for A.B.E. receipts

async function sha256HexFromBuffer(buffer) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  return hashHex;
}

async function sha256HexFromString(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  return sha256HexFromBuffer(data);
}

function setResult(message, ok, computedHash) {
  const resultEl = document.getElementById("verify-result");
  const hashEl = document.getElementById("verify-computed-hash");

  resultEl.textContent = message;
  resultEl.className = ok ? "verify-result ok" : "verify-result bad";

  if (computedHash) {
    hashEl.textContent = computedHash;
  } else {
    hashEl.textContent = "";
  }
}

async function handleVerifyClick(evt) {
  evt.preventDefault();

  const expectedInput = document.getElementById("expected-hash");
  const textInput = document.getElementById("audit-text");
  const fileInput = document.getElementById("audit-file");

  const expected = (expectedInput.value || "").trim().toLowerCase();

  if (!expected) {
    setResult("Please enter the expected SHA-256 hash to verify against.", false);
    return;
  }

  let sourceLabel = "";
  let computePromise = null;

  // Priority: file if provided, otherwise text
  const file = fileInput.files && fileInput.files[0];
  if (file) {
    sourceLabel = `file: ${file.name}`;
    const reader = new FileReader();
    computePromise = new Promise((resolve, reject) => {
      reader.onerror = () => reject(reader.error);
      reader.onload = async () => {
        try {
          const buffer = reader.result;
          const hash = await sha256HexFromBuffer(buffer);
          resolve(hash);
        } catch (e) {
          reject(e);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  } else {
    const text = textInput.value || "";
    if (!text.trim()) {
      setResult("Paste the audit content or upload a file to verify.", false);
      return;
    }
    sourceLabel = "pasted text";
    computePromise = sha256HexFromString(text);
  }

  setResult("Computing SHA-256 hash…", false);

  try {
    const computed = (await computePromise).toLowerCase();
    const matches = computed === expected;

    if (matches) {
      setResult(
        "✅ Hash match. This content matches the recorded SHA-256 audit hash.",
        true,
        computed
      );
    } else {
      setResult(
        "❌ Hash mismatch. This content does NOT match the recorded SHA-256 audit hash.",
        false,
        computed
      );
    }

    const detailsEl = document.getElementById("verify-details");
    detailsEl.textContent =
      "Source verified: " + sourceLabel +
      ". If this receipt is attached to a court filing, this hash can be recomputed by any party to confirm that the audit output has not been altered since it was generated.";
  } catch (err) {
    console.error(err);
    setResult("Error computing hash. Your browser may not support Web Crypto, or the file could not be read.", false);
  }
}

document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("verify-form");
  if (form) {
    form.addEventListener("submit", handleVerifyClick);
  }
});
