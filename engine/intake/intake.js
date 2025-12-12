// engine/intake/intake.js
(function () {
  const STORAGE_KEY = "ABE_IntakeSession";

  function byId(id) {
    return document.getElementById(id);
  }

  function parseStatutes(rawText) {
    if (!rawText) return [];
    return rawText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        // Very loose parse: "citation — title"
        const parts = line.split(/[-–—]/); // dash variations
        const citation = (parts[0] || "").trim();
        const title = (parts[1] || "").trim();
        return {
          raw: line,
          citation: citation || "",
          title: title || ""
        };
      });
  }

  function handleSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const statusEl = byId("intake-status");
    if (statusEl) statusEl.textContent = "Saving intake session…";

    const formData = new FormData(form);

    const state = (formData.get("state") || "").toString().trim();
    const county = (formData.get("county") || "").toString().trim();
    const date = (formData.get("date") || "").toString();
    const eventType = (formData.get("event_type") || "").toString();
    const vehicleUse = (formData.get("vehicle_use") || "").toString();
    const hasCdl = formData.get("has_cdl") === "yes";
    const officerAgency = (formData.get("officer_agency") || "")
      .toString()
      .trim();
    const statutesRaw = (formData.get("statutes") || "")
      .toString();
    const notes = (formData.get("notes") || "").toString();
    const file = formData.get("attachment");

    const statutes = parseStatutes(statutesRaw);

    const attachment =
      file && file.name
        ? {
            file_name: file.name,
            file_type: file.type || "unknown"
          }
        : null;

    const intake = {
      jurisdiction: {
        country: "United States",
        state,
        county: county || ""
      },
      event: {
        type: eventType || "traffic_stop",
        date,
        notes
      },
      driver_context: {
        vehicle_use: vehicleUse || "personal",
        has_cdl: hasCdl,
        officer_agency: officerAgency
      },
      statutes,
      attachment,
      created_at: new Date().toISOString()
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(intake));
      if (statusEl) {
        statusEl.textContent =
          "Intake session saved locally. Next step will use this for legal, funding, and constitutional audits.";
      }
      // Later, when results.html is ready, we can auto-redirect:
      // window.location.href = "results.html";
    } catch (e) {
      console.error("Error saving intake:", e);
      if (statusEl) {
        statusEl.textContent =
          "Could not save intake session (localStorage error).";
      }
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("intake-form");
    if (!form) return;
    form.addEventListener("submit", handleSubmit);
  });
})();
