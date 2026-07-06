 import React, { useState, useMemo, useEffect } from "react";

// ═══════════════════════════════════════════════════════════
// London Rental Companion — Phase 1
// New: listing URL import, TfL commute times, photos per
// viewing, shareable hunt codes, zone travelcard estimates,
// referencing/affordability checks, council lookup.
// ═══════════════════════════════════════════════════════════

const LINES = {
  money: { name: "Money", color: "#DC241F" },
  tenancy: { name: "Tenancy", color: "#0019A8" },
  safety: { name: "Condition & Safety", color: "#00782A" },
  practical: { name: "Practicalities", color: "#F3A9BB" },
  share: { name: "House Shares", color: "#95CDBA" },
};

const QUESTIONS = [
  { line: "money", t: "Exact monthly rent — anything included (bills, council tax, Wi-Fi)?" },
  { line: "money", t: "Deposit amount + which protection scheme (DPS / MyDeposits / TDS)?" },
  { line: "money", t: "Holding deposit — when is it refundable?" },
  { line: "money", t: "Council tax band and annual cost?" },
  { line: "money", t: "Any other charges? (Admin/referencing fees are illegal)" },
  { line: "money", t: "When was rent last increased — is a rise planned?" },
  { line: "tenancy", t: "Tenancy type and length — is there a break clause?" },
  { line: "tenancy", t: "Notice periods for both sides?" },
  { line: "tenancy", t: "Will you accept a guarantor? What must they earn?" },
  { line: "tenancy", t: "Can I see a draft tenancy agreement before paying anything?" },
  { line: "tenancy", t: "Who manages the property day to day?" },
  { line: "safety", t: "Gas Safety Certificate, EICR and EPC — can I see them?" },
  { line: "safety", t: "Smoke alarms every floor + CO alarm? (legal requirement)" },
  { line: "safety", t: "Any history of damp, mould, or pests?" },
  { line: "safety", t: "Boiler age, last service, heating type?" },
  { line: "safety", t: "Run a tap — water pressure OK?" },
  { line: "safety", t: "Double glazing / insulation?" },
  { line: "practical", t: "Broadband options and speed?" },
  { line: "practical", t: "Mobile signal indoors?" },
  { line: "practical", t: "Bins, bike storage, parking?" },
  { line: "practical", t: "Noise — pubs, main road, flight path? Why is the tenant leaving?" },
  { line: "practical", t: "Professional inventory + check-in report done?" },
  { line: "share", t: "HMO licence if 3+ sharers? Ask to see it" },
  { line: "share", t: "Joint tenancy or individual room contract?" },
  { line: "share", t: "Can I meet the current flatmates?" },
];

const SPOT_CHECKS = [
  "Damp / mould (corners, behind furniture)",
  "Water pressure (run the shower)",
  "Phone signal inside",
  "Window locks + front door security",
  "Evening feel of the street",
  "Walk time to station (time it)",
];

// Approximate monthly Zone 1–N travelcard costs — editable estimates
const ZONE_COSTS = { "1-2": 171, "1-3": 201, "1-4": 246, "1-5": 292, "1-6": 313 };

const CONTACT_ROLES = ["Agent", "Landlord", "Flatmate", "Guarantor", "Other"];

// ——— Listing URL parsing ———
const SITES = [
  { match: "rightmove", name: "Rightmove" },
  { match: "zoopla", name: "Zoopla" },
  { match: "spareroom", name: "SpareRoom" },
  { match: "openrent", name: "OpenRent" },
  { match: "onthemarket", name: "OnTheMarket" },
  { match: "gumtree", name: "Gumtree" },
];
const parseListing = (raw) => {
  try {
    const url = new URL(raw.trim());
    const site = SITES.find((s) => url.hostname.includes(s.match));
    const idMatch = (url.pathname + url.search).match(/(\d{5,})/);
    return {
      ok: true,
      site: site ? site.name : url.hostname.replace("www.", ""),
      id: idMatch ? idMatch[1] : null,
      url: url.href,
    };
  } catch {
    return { ok: false };
  }
};

// ——— Photo compression (keeps localStorage small) ———
const compressImage = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 520;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.6));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const emptyProperty = () => ({
  id: Date.now(),
  name: "", rent: "", rating: 0, checks: {}, notes: "",
  url: "", site: "", postcode: "", commute: null, photos: [],
});

// ——— Persistence ———
const STORE_KEY = "rental-companion-v2";
const loadState = () => {
  try {
    const raw = localStorage.getItem(STORE_KEY) || localStorage.getItem("rental-companion-v1");
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
};
const saved = loadState();

export default function App() {
  const [tab, setTab] = useState("budget");
  const [ticked, setTicked] = useState(saved.ticked || {});
  const [props, setProps] = useState((saved.props || []).map((p) => ({ ...emptyProperty(), ...p, id: p.id })));
  const [active, setActive] = useState(null);
  const [exportText, setExportText] = useState("");
  const [copied, setCopied] = useState(false);
  const [contacts, setContacts] = useState(saved.contacts || []);
  const [editingContact, setEditingContact] = useState(null);
  const [anchor, setAnchor] = useState(saved.anchor || "");
  const [b, setB] = useState(
    saved.budget || { takeHome: "", rent: "", councilTax: "", bills: "150", travel: "120", broadband: "15", zone: "" }
  );
  const [council, setCouncil] = useState({ postcode: "", result: null, busy: false });
  const [shareOpen, setShareOpen] = useState(false);
  const [importCode, setImportCode] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [storageWarn, setStorageWarn] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ ticked, props, contacts, budget: b, anchor }));
      setStorageWarn(false);
    } catch {
      setStorageWarn(true); // usually photo quota
    }
  }, [ticked, props, contacts, b, anchor]);

  const num = (v) => parseFloat(v) || 0;
  const trueCost = num(b.rent) + num(b.councilTax) + num(b.bills) + num(b.travel) + num(b.broadband);
  const pct = num(b.takeHome) > 0 ? Math.round((trueCost / num(b.takeHome)) * 100) : null;
  const upfront = num(b.rent) > 0 ? Math.round(num(b.rent) * (1 + 5 / 4.33)) : 0;
  // Standard agent referencing: salary ≥ 30× monthly rent; guarantor ≥ 36×
  const reqSalary = num(b.rent) > 0 ? Math.round(num(b.rent) * 30) : 0;
  const reqGuarantor = num(b.rent) > 0 ? Math.round(num(b.rent) * 36) : 0;

  const doneCount = Object.values(ticked).filter(Boolean).length;
  const updateProp = (id, patch) => setProps((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const activeProp = props.find((p) => p.id === active);
  const sorted = useMemo(() => [...props].sort((a, z) => z.rating - a.rating), [props]);
  const updateContact = (id, patch) => setContacts((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const sortedContacts = [...contacts].sort((a, z) => (z.fav ? 1 : 0) - (a.fav ? 1 : 0));
  const emptyContact = () => ({ id: Date.now(), name: "", role: "Agent", phone: "", email: "", fav: false, note: "" });

  // ——— Listing import ———
  const [pasteUrl, setPasteUrl] = useState("");
  const importListing = () => {
    const r = parseListing(pasteUrl);
    if (!r.ok) { setImportMsg("That doesn't look like a valid link."); return; }
    const p = { ...emptyProperty(), url: r.url, site: r.site, name: r.site + (r.id ? " #" + r.id.slice(-5) : "") };
    setProps((ps) => [...ps, p]);
    setPasteUrl("");
    setActive(p.id);
  };

  // ——— TfL commute ———
  const planCommute = async (p) => {
    if (!p.postcode.trim() || !anchor.trim()) return;
    updateProp(p.id, { commute: { busy: true } });
    try {
      const res = await fetch(
        `https://api.tfl.gov.uk/Journey/JourneyResults/${encodeURIComponent(p.postcode.trim())}/to/${encodeURIComponent(anchor.trim())}`
      );
      const data = await res.json();
      if (data.journeys && data.journeys.length) {
        const best = data.journeys.reduce((a, z) => (z.duration < a.duration ? z : a));
        const modes = [...new Set(best.legs.map((l) => l.mode?.name).filter((m) => m && m !== "walking"))];
        updateProp(p.id, { commute: { mins: best.duration, modes: modes.join(" + ") || "walk", to: anchor.trim() } });
      } else {
        updateProp(p.id, { commute: { error: "TfL couldn't plan that — check both postcodes are full (e.g. SE15 4QL)." } });
      }
    } catch {
      updateProp(p.id, { commute: { error: "Couldn't reach TfL — check your connection and try again." } });
    }
  };

  // ——— Council lookup (postcodes.io) ———
  const lookupCouncil = async () => {
    if (!council.postcode.trim()) return;
    setCouncil((c) => ({ ...c, busy: true, result: null }));
    try {
      const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(council.postcode.trim())}`);
      const data = await res.json();
      if (data.status === 200) {
        setCouncil((c) => ({ ...c, busy: false, result: { district: data.result.admin_district, ok: true } }));
      } else {
        setCouncil((c) => ({ ...c, busy: false, result: { ok: false } }));
      }
    } catch {
      setCouncil((c) => ({ ...c, busy: false, result: { ok: false } }));
    }
  };

  // ——— Photos ———
  const addPhotos = async (p, files) => {
    const room = 3 - p.photos.length;
    const list = Array.from(files).slice(0, room);
    const done = [];
    for (const f of list) {
      try { done.push(await compressImage(f)); } catch {}
    }
    if (done.length) updateProp(p.id, { photos: [...p.photos, ...done] });
  };

  // ——— Share / import hunt ———
  const buildShareCode = () => {
    const slim = props.map(({ photos, ...rest }) => rest); // photos too big to share
    const payload = JSON.stringify({ v: 2, props: slim, contacts });
    return btoa(unescape(encodeURIComponent(payload)));
  };
  const importHunt = () => {
    try {
      const data = JSON.parse(decodeURIComponent(escape(atob(importCode.trim()))));
      const existing = new Set(props.map((p) => p.name + "|" + p.rent));
      const incoming = (data.props || [])
        .filter((p) => !existing.has(p.name + "|" + p.rent))
        .map((p, i) => ({ ...emptyProperty(), ...p, id: Date.now() + i, photos: [] }));
      const existingC = new Set(contacts.map((c) => c.name + "|" + c.phone));
      const incomingC = (data.contacts || [])
        .filter((c) => !existingC.has(c.name + "|" + c.phone))
        .map((c, i) => ({ ...c, id: Date.now() + 1000 + i }));
      setProps([...props, ...incoming]);
      setContacts([...contacts, ...incomingC]);
      setImportMsg(`Imported ${incoming.length} viewing${incoming.length === 1 ? "" : "s"} and ${incomingC.length} contact${incomingC.length === 1 ? "" : "s"}.`);
      setImportCode("");
    } catch {
      setImportMsg("That code didn't work — make sure the whole thing was pasted.");
    }
  };

  const buildExport = () => {
    const ranked = [...props].sort((a, z) => z.rating - a.rating);
    const lines = ["LONDON FLAT SEARCH — VIEWING NOTES", `Exported ${new Date().toLocaleDateString("en-GB")}`, ""];
    ranked.forEach((p, i) => {
      lines.push(`#${i + 1}  ${p.name || "Untitled"}  ${"★".repeat(p.rating)}${"☆".repeat(5 - p.rating)}`);
      if (p.rent) lines.push(`    Rent: £${p.rent}/month`);
      if (p.commute?.mins) lines.push(`    Commute: ${p.commute.mins} min (${p.commute.modes}) to ${p.commute.to}`);
      if (p.url) lines.push(`    Listing: ${p.url}`);
      const passed = SPOT_CHECKS.filter((_, idx) => p.checks[idx]);
      const failed = SPOT_CHECKS.filter((_, idx) => !p.checks[idx]);
      if (passed.length) lines.push(`    OK: ${passed.join(" · ")}`);
      if (failed.length) lines.push(`    Not checked/failed: ${failed.join(" · ")}`);
      if (p.notes) lines.push(`    Notes: ${p.notes}`);
      lines.push("");
    });
    if (contacts.length) {
      lines.push("CONTACTS");
      [...contacts].sort((a, z) => (z.fav ? 1 : 0) - (a.fav ? 1 : 0)).forEach((c) => {
        lines.push(`${c.fav ? "★ " : "  "}${c.name || "Unnamed"} (${c.role})${c.phone ? " · " + c.phone : ""}${c.email ? " · " + c.email : ""}${c.note ? " — " + c.note : ""}`);
      });
      lines.push("");
    }
    return lines.join("\n");
  };
  const handleExport = async () => {
    const text = buildExport();
    setExportText(text);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { setCopied(false); }
  };

  return (
    <div style={S.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;900&family=Public+Sans:wght@400;600&display=swap');
        * { box-sizing: border-box; }
        button, input, textarea { font-family: inherit; }
        input:focus, textarea:focus, button:focus-visible { outline: 3px solid #DC241F33; outline-offset: 1px; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
      `}</style>

      <header style={S.header}>
        <div style={S.roundel}><div style={S.roundelBar}>FLAT&nbsp;FINDER</div></div>
        <div>
          <h1 style={S.h1}>London Rental Companion</h1>
          <p style={S.sub}>Budget it. Ask it. Score it.</p>
        </div>
      </header>

      {storageWarn && (
        <div style={S.warnBanner}>
          Storage is full — new changes may not save. Try removing some photos from older viewings.
        </div>
      )}

      <nav style={S.tabs}>
        {[
          ["budget", "True Cost"],
          ["questions", `Questions ${doneCount > 0 ? `· ${doneCount}/${QUESTIONS.length}` : ""}`],
          ["properties", `Viewings ${props.length > 0 ? `· ${props.length}` : ""}`],
          ["contacts", `Contacts ${contacts.length > 0 ? `· ${contacts.length}` : ""}`],
        ].map(([k, label]) => (
          <button key={k} onClick={() => { setTab(k); setActive(null); }} style={{ ...S.tab, ...(tab === k ? S.tabOn : {}) }}>
            {label}
          </button>
        ))}
      </nav>

      {/* ═══ TRUE COST ═══ */}
      {tab === "budget" && (
        <>
          <section style={S.card}>
            <h2 style={S.h2}>What a listing really costs</h2>
            <p style={S.hint}>A "£{b.rent || "900"}/month" advert is never £{b.rent || "900"}/month. Fill this in before falling in love with a place.</p>
            {[
              ["takeHome", "Monthly take-home pay (est.)"],
              ["rent", "Advertised rent"],
              ["councilTax", "Council tax (your share)"],
              ["bills", "Gas / electric / water (share)"],
              ["travel", "Travelcard / transport"],
              ["broadband", "Broadband + extras"],
            ].map(([k, label]) => (
              <label key={k} style={S.row}>
                <span style={S.rowLabel}>{label}</span>
                <span style={S.inputWrap}>
                  <span style={S.unit}>£</span>
                  <input inputMode="decimal" value={b[k]} onChange={(e) => setB({ ...b, [k]: e.target.value })} style={S.input} placeholder="0" />
                </span>
              </label>
            ))}

            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12.5, color: "#5B6472", marginBottom: 6 }}>Quick-fill travel from your zones (est. monthly travelcard):</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {Object.entries(ZONE_COSTS).map(([z, cost]) => (
                  <button key={z} onClick={() => setB({ ...b, travel: String(cost), zone: z })}
                    style={{ ...S.roleBtn, ...(b.zone === z ? S.roleBtnOn : {}) }}>
                    Z{z} £{cost}
                  </button>
                ))}
              </div>
            </div>

            <div style={S.totalBlock}>
              <div style={S.totalLabel}>True monthly cost</div>
              <div style={S.totalNum}>£{trueCost.toLocaleString()}</div>
              {pct !== null && (
                <div style={{ ...S.badge, background: pct > 45 ? "#DC241F" : pct > 38 ? "#B26300" : "#00782A" }}>
                  {pct}% of take-home {pct > 45 ? "— too high" : pct > 38 ? "— stretching" : "— healthy"}
                </div>
              )}
              {upfront > 0 && (
                <p style={S.hint}>Cash needed upfront (first month + 5-week deposit): <strong>≈ £{upfront.toLocaleString()}</strong></p>
              )}
            </div>
          </section>

          {reqSalary > 0 && (
            <section style={S.card}>
              <h2 style={S.h2}>Will you pass referencing?</h2>
              <p style={S.hint}>Most agents require one of these for a £{num(b.rent).toLocaleString()}/month rent:</p>
              <div style={S.refRow}><span style={S.refBig}>£{reqSalary.toLocaleString()}</span> your annual salary (30× monthly rent)</div>
              <div style={S.refRow}><span style={S.refBig}>£{reqGuarantor.toLocaleString()}</span> or a UK guarantor's salary (36×)</div>
              <div style={S.refRow}><span style={S.refBig}>£{Math.round(num(b.rent) * 6).toLocaleString()}+</span> or 6–12 months' rent upfront</div>
              <p style={{ ...S.hint, marginBottom: 0 }}>Job offer letters usually count as proof of income — ask the agent before assuming you need a guarantor.</p>
            </section>
          )}

          <section style={S.card}>
            <h2 style={S.h2}>Which council is it?</h2>
            <p style={S.hint}>Council tax varies a lot between boroughs. Look up the borough, then check its band rates on the council's site.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <input style={{ ...S.input, flex: 1, width: "auto", background: "#F7F6F2", borderRadius: 8, padding: "9px 10px", border: "1.5px solid #E4E1D8" }}
                placeholder="Postcode, e.g. SE15 4QL" value={council.postcode}
                onChange={(e) => setCouncil({ ...council, postcode: e.target.value })} />
              <button style={S.smallBtn} onClick={lookupCouncil} disabled={council.busy}>
                {council.busy ? "…" : "Look up"}
              </button>
            </div>
            {council.result && (
              <p style={{ ...S.hint, marginTop: 10, marginBottom: 0 }}>
                {council.result.ok
                  ? <>That's in <strong>{council.result.district}</strong> — search "{council.result.district} council tax bands" for exact rates.</>
                  : "Couldn't find that postcode — check it's complete."}
              </p>
            )}
          </section>
        </>
      )}

      {/* ═══ QUESTIONS ═══ */}
      {tab === "questions" && (
        <section>
          {Object.entries(LINES).map(([key, line]) => (
            <div key={key} style={S.card}>
              <div style={S.lineHead}>
                <span style={{ ...S.lineBar, background: line.color }} />
                <h2 style={S.h2}>{line.name}</h2>
              </div>
              {QUESTIONS.filter((q) => q.line === key).map((q, i) => {
                const id = key + i;
                const on = !!ticked[id];
                return (
                  <button key={id} onClick={() => setTicked({ ...ticked, [id]: !on })} style={{ ...S.qRow, opacity: on ? 0.45 : 1 }}>
                    <span style={{ ...S.tick, borderColor: line.color, background: on ? line.color : "transparent" }}>{on ? "✓" : ""}</span>
                    <span style={{ textDecoration: on ? "line-through" : "none", textAlign: "left" }}>{q.t}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </section>
      )}

      {/* ═══ VIEWINGS LIST ═══ */}
      {tab === "properties" && !activeProp && (
        <section>
          <div style={S.card}>
            <h2 style={S.h2}>Add from a listing link</h2>
            <p style={S.hint}>Paste a Rightmove, Zoopla, SpareRoom or OpenRent link — it becomes a viewing with the link saved.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <input style={{ ...S.input, flex: 1, width: "auto", background: "#F7F6F2", borderRadius: 8, padding: "9px 10px", border: "1.5px solid #E4E1D8" }}
                placeholder="https://www.rightmove.co.uk/properties/…" value={pasteUrl}
                onChange={(e) => { setPasteUrl(e.target.value); setImportMsg(""); }} />
              <button style={S.smallBtn} onClick={importListing}>Add</button>
            </div>
            {importMsg && <p style={{ ...S.hint, marginTop: 8, marginBottom: 0 }}>{importMsg}</p>}
          </div>

          <div style={S.card}>
            <label style={S.row}>
              <span style={S.rowLabel}><strong>Commute anchor</strong> — work/uni postcode for travel times</span>
              <input style={{ ...S.input, width: 120, background: "#F7F6F2", borderRadius: 8, padding: "8px 10px", border: "1.5px solid #E4E1D8" }}
                placeholder="EC2A 4BX" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
            </label>
          </div>

          <button style={S.addBtn} onClick={() => { const p = emptyProperty(); setProps([...props, p]); setActive(p.id); }}>
            + Add a viewing manually
          </button>

          {sorted.length > 1 && (
            <div style={S.card}>
              <h2 style={S.h2}>Compare</h2>
              {sorted.map((p, i) => (
                <div key={p.id} style={S.compareRow}>
                  <span style={S.rank}>{i + 1}</span>
                  <span style={{ flex: 1, fontWeight: 600 }}>{p.name || "Untitled"}</span>
                  <span style={S.mono}>{p.rent ? `£${p.rent}` : "—"}</span>
                  <span style={{ ...S.mono, minWidth: 52, textAlign: "right" }}>{p.commute?.mins ? `${p.commute.mins}m` : ""}</span>
                  <span aria-label={`${p.rating} of 5`}>{"●".repeat(p.rating)}{"○".repeat(5 - p.rating)}</span>
                </div>
              ))}
            </div>
          )}

          {props.map((p) => (
            <button key={p.id} style={S.propCard} onClick={() => setActive(p.id)}>
              <div style={{ display: "flex", gap: 10 }}>
                {p.photos[0] && <img src={p.photos[0]} alt="" style={S.thumbSm} />}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 17 }}>{p.name || "Untitled viewing"}</div>
                  <div style={S.hint}>
                    {p.rent ? `£${p.rent}/mo · ` : ""}
                    {p.commute?.mins ? `${p.commute.mins} min commute · ` : ""}
                    {"●".repeat(p.rating)}{"○".repeat(5 - p.rating)} · {Object.values(p.checks).filter(Boolean).length}/{SPOT_CHECKS.length} checks
                  </div>
                </div>
              </div>
            </button>
          ))}

          {props.length === 0 && (
            <p style={{ ...S.hint, textAlign: "center", marginTop: 24 }}>
              No viewings yet. Paste a listing link above, or add one manually before you walk through the door.
            </p>
          )}

          {props.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <button style={S.exportBtn} onClick={handleExport}>{copied ? "✓ Copied to clipboard" : "Export notes as text"}</button>
              {exportText && (
                <div style={S.card}>
                  <p style={S.hint}>{copied ? "Copied — paste it into Notes, WhatsApp, or an email to yourself." : "Tap the box, select all, and copy."}</p>
                  <textarea readOnly style={{ ...S.textarea, fontFamily: "ui-monospace, monospace", fontSize: 12.5 }}
                    rows={Math.min(16, exportText.split("\n").length)} value={exportText} onFocus={(e) => e.target.select()} />
                </div>
              )}
            </div>
          )}

          <button style={{ ...S.exportBtn, background: "#0019A8", marginTop: 4 }} onClick={() => { setShareOpen(!shareOpen); setImportMsg(""); }}>
            {shareOpen ? "Hide hunt sharing" : "Share hunt with a friend"}
          </button>
          {shareOpen && (
            <div style={S.card}>
              <h2 style={S.h2}>Hunting together?</h2>
              <p style={S.hint}>Send this code to a friend (WhatsApp is fine). They paste it below on their phone and your viewings and contacts merge into theirs. Photos stay on your device.</p>
              <textarea readOnly style={{ ...S.textarea, fontFamily: "ui-monospace, monospace", fontSize: 11 }} rows={3}
                value={props.length ? buildShareCode() : "Add a viewing first"} onFocus={(e) => e.target.select()} />
              <div style={{ marginTop: 14, fontWeight: 700 }}>Got a code from someone?</div>
              <textarea style={{ ...S.textarea, fontFamily: "ui-monospace, monospace", fontSize: 11, marginTop: 6 }} rows={3}
                placeholder="Paste their code here" value={importCode} onChange={(e) => setImportCode(e.target.value)} />
              <button style={{ ...S.smallBtn, marginTop: 8 }} onClick={importHunt}>Import their hunt</button>
              {importMsg && <p style={{ ...S.hint, marginTop: 8, marginBottom: 0 }}>{importMsg}</p>}
            </div>
          )}
        </section>
      )}

      {/* ═══ SINGLE PROPERTY ═══ */}
      {tab === "properties" && activeProp && (
        <section style={S.card}>
          <button style={S.backBtn} onClick={() => setActive(null)}>← All viewings</button>
          <input style={{ ...S.input, width: "100%", fontSize: 18, fontWeight: 700, marginTop: 10, background: "#F7F6F2", borderRadius: 8, padding: "10px" }}
            placeholder="Nickname — e.g. 'Peckham blue door'" value={activeProp.name}
            onChange={(e) => updateProp(activeProp.id, { name: e.target.value })} />

          {activeProp.url && (
            <a href={activeProp.url} target="_blank" rel="noreferrer" style={{ ...S.contactAction, marginTop: 10 }}>
              Open listing on {activeProp.site} ↗
            </a>
          )}

          <label style={{ ...S.row, marginTop: 10 }}>
            <span style={S.rowLabel}>Rent / month</span>
            <span style={S.inputWrap}>
              <span style={S.unit}>£</span>
              <input inputMode="decimal" style={S.input} value={activeProp.rent}
                onChange={(e) => updateProp(activeProp.id, { rent: e.target.value })} placeholder="0" />
            </span>
          </label>

          {/* Commute */}
          <div style={{ margin: "16px 0 6px", fontWeight: 700 }}>Commute</div>
          {!anchor.trim() ? (
            <p style={S.hint}>Set your work/uni postcode on the viewings page first, then check travel time from here.</p>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8 }}>
                <input style={{ ...S.input, flex: 1, width: "auto", background: "#F7F6F2", borderRadius: 8, padding: "9px 10px", border: "1.5px solid #E4E1D8" }}
                  placeholder="This property's postcode" value={activeProp.postcode}
                  onChange={(e) => updateProp(activeProp.id, { postcode: e.target.value })} />
                <button style={S.smallBtn} onClick={() => planCommute(activeProp)} disabled={activeProp.commute?.busy}>
                  {activeProp.commute?.busy ? "…" : "Check"}
                </button>
              </div>
              {activeProp.commute?.mins && (
                <p style={{ ...S.hint, marginTop: 8 }}>
                  <strong style={{ color: "#00782A", fontSize: 16 }}>{activeProp.commute.mins} min</strong> via {activeProp.commute.modes} to {activeProp.commute.to} (live TfL data)
                </p>
              )}
              {activeProp.commute?.error && <p style={{ ...S.hint, marginTop: 8, color: "#DC241F" }}>{activeProp.commute.error}</p>}
            </>
          )}

          {/* Photos */}
          <div style={{ margin: "16px 0 6px", fontWeight: 700 }}>Photos <span style={{ fontWeight: 400, color: "#5B6472", fontSize: 12 }}>({activeProp.photos.length}/3)</span></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {activeProp.photos.map((src, i) => (
              <div key={i} style={{ position: "relative" }}>
                <img src={src} alt={`Photo ${i + 1}`} style={S.thumb} />
                <button style={S.thumbX} aria-label="Remove photo"
                  onClick={() => updateProp(activeProp.id, { photos: activeProp.photos.filter((_, j) => j !== i) })}>×</button>
              </div>
            ))}
            {activeProp.photos.length < 3 && (
              <label style={S.thumbAdd}>
                +
                <input type="file" accept="image/*" multiple style={{ display: "none" }}
                  onChange={(e) => { addPhotos(activeProp, e.target.files); e.target.value = ""; }} />
              </label>
            )}
          </div>
          <p style={{ ...S.hint, marginTop: 6 }}>Snap the damp patch, the boiler, the view — whatever you'll forget by viewing #4.</p>

          <div style={{ margin: "16px 0 6px", fontWeight: 700 }}>Gut rating</div>
          <div>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => updateProp(activeProp.id, { rating: n })}
                style={{ ...S.star, color: n <= activeProp.rating ? "#DC241F" : "#C9C5BB" }} aria-label={`Rate ${n} of 5`}>●</button>
            ))}
          </div>

          <div style={{ margin: "16px 0 6px", fontWeight: 700 }}>Spot checks</div>
          {SPOT_CHECKS.map((c, i) => {
            const on = !!activeProp.checks[i];
            return (
              <button key={i} style={{ ...S.qRow, opacity: on ? 0.5 : 1 }}
                onClick={() => updateProp(activeProp.id, { checks: { ...activeProp.checks, [i]: !on } })}>
                <span style={{ ...S.tick, borderColor: "#10243E", background: on ? "#10243E" : "transparent" }}>{on ? "✓" : ""}</span>
                <span style={{ textAlign: "left" }}>{c}</span>
              </button>
            );
          })}

          <div style={{ margin: "16px 0 6px", fontWeight: 700 }}>Notes</div>
          <textarea style={S.textarea} rows={4} placeholder="Smell? Flatmates? What did the agent dodge?"
            value={activeProp.notes} onChange={(e) => updateProp(activeProp.id, { notes: e.target.value })} />

          <button style={S.deleteBtn} onClick={() => { setProps(props.filter((p) => p.id !== activeProp.id)); setActive(null); }}>
            Delete this viewing
          </button>
        </section>
      )}

      {/* ═══ CONTACTS ═══ */}
      {tab === "contacts" && (
        <section>
          <button style={S.addBtn} onClick={() => { const c = emptyContact(); setContacts([...contacts, c]); setEditingContact(c.id); }}>
            + Add a contact
          </button>
          {contacts.length === 0 && (
            <p style={{ ...S.hint, textAlign: "center", marginTop: 24 }}>
              Save agents, landlords and potential flatmates here. Star your favourites so they float to the top.
            </p>
          )}
          {sortedContacts.map((c) => {
            const editing = editingContact === c.id;
            return (
              <div key={c.id} style={S.card}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button onClick={() => updateContact(c.id, { fav: !c.fav })}
                    style={{ ...S.starBtn, color: c.fav ? "#DC241F" : "#C9C5BB" }}
                    aria-label={c.fav ? "Remove from favourites" : "Add to favourites"}>★</button>
                  {editing ? (
                    <input style={{ ...S.input, flex: 1, width: "auto", fontWeight: 700, fontSize: 16, background: "#F7F6F2", borderRadius: 8, padding: "8px 10px" }}
                      placeholder="Name" value={c.name} onChange={(e) => updateContact(c.id, { name: e.target.value })} />
                  ) : (
                    <div style={{ flex: 1, fontWeight: 700, fontSize: 16 }}>
                      {c.name || "Unnamed"} <span style={S.roleChip}>{c.role}</span>
                    </div>
                  )}
                  <button style={S.backBtn} onClick={() => setEditingContact(editing ? null : c.id)}>{editing ? "Done" : "Edit"}</button>
                </div>
                {editing ? (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                      {CONTACT_ROLES.map((r) => (
                        <button key={r} onClick={() => updateContact(c.id, { role: r })}
                          style={{ ...S.roleBtn, ...(c.role === r ? S.roleBtnOn : {}) }}>{r}</button>
                      ))}
                    </div>
                    <label style={S.row}>
                      <span style={S.rowLabel}>Phone</span>
                      <input inputMode="tel" style={{ ...S.input, width: 170, background: "#F7F6F2", borderRadius: 8, padding: "8px 10px" }}
                        value={c.phone} onChange={(e) => updateContact(c.id, { phone: e.target.value })} placeholder="07…" />
                    </label>
                    <label style={S.row}>
                      <span style={S.rowLabel}>Email</span>
                      <input inputMode="email" style={{ ...S.input, width: 170, background: "#F7F6F2", borderRadius: 8, padding: "8px 10px" }}
                        value={c.email} onChange={(e) => updateContact(c.id, { email: e.target.value })} placeholder="name@…" />
                    </label>
                    <textarea style={{ ...S.textarea, marginTop: 4 }} rows={2}
                      placeholder="Note — e.g. 'handles the Peckham flat, responsive on WhatsApp'"
                      value={c.note} onChange={(e) => updateContact(c.id, { note: e.target.value })} />
                    <button style={S.deleteBtn} onClick={() => { setContacts(contacts.filter((x) => x.id !== c.id)); setEditingContact(null); }}>
                      Delete contact
                    </button>
                  </div>
                ) : (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {c.phone && <a href={`tel:${c.phone.replace(/\s/g, "")}`} style={S.contactAction}>Call {c.phone}</a>}
                      {c.email && <a href={`mailto:${c.email}`} style={S.contactAction}>Email</a>}
                    </div>
                    {c.note && <p style={{ ...S.hint, marginBottom: 0 }}>{c.note}</p>}
                    {!c.phone && !c.email && !c.note && <p style={{ ...S.hint, marginBottom: 0 }}>No details yet — tap Edit.</p>}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      <footer style={S.footer}>
        Deposit cap: 5 weeks · Holding deposit: 1 week max · Admin fees: illegal ·
        Deposit must be protected within 30 days. Check shelter.org.uk before signing.
        Travelcard figures are estimates — verify at tfl.gov.uk.
        <div style={{ marginTop: 10 }}>
          <button
            style={{ background: "transparent", border: "none", color: "#5B6472", textDecoration: "underline", fontSize: 11, cursor: "pointer" }}
            onClick={() => {
              if (window.confirm("Delete all saved viewings, photos, contacts, ticks and budget? This can't be undone.")) {
                try { localStorage.removeItem(STORE_KEY); localStorage.removeItem("rental-companion-v1"); } catch {}
                setTicked({}); setProps([]); setContacts([]); setActive(null); setAnchor("");
                setB({ takeHome: "", rent: "", councilTax: "", bills: "150", travel: "120", broadband: "15", zone: "" });
              }
            }}>
            Reset all data
          </button>
        </div>
      </footer>
    </div>
  );
}

const S = {
  page: { fontFamily: "'Public Sans', system-ui, sans-serif", background: "#F7F6F2", minHeight: "100vh", color: "#10243E", maxWidth: 560, margin: "0 auto", padding: "0 14px 40px" },
  header: { display: "flex", alignItems: "center", gap: 14, padding: "22px 2px 14px" },
  roundel: { width: 58, height: 58, borderRadius: "50%", border: "7px solid #DC241F", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: "#F7F6F2" },
  roundelBar: { background: "#0019A8", color: "#fff", fontFamily: "'Archivo', sans-serif", fontWeight: 900, fontSize: 7.5, letterSpacing: 0.5, padding: "3px 6px", whiteSpace: "nowrap" },
  h1: { fontFamily: "'Archivo', sans-serif", fontWeight: 900, fontSize: 22, margin: 0, letterSpacing: -0.3 },
  sub: { margin: "2px 0 0", fontSize: 13, color: "#5B6472" },
  warnBanner: { background: "#B26300", color: "#fff", fontSize: 12.5, fontWeight: 600, borderRadius: 10, padding: "8px 12px", marginBottom: 10 },
  tabs: { display: "flex", gap: 6, marginBottom: 14, position: "sticky", top: 0, background: "#F7F6F2", padding: "8px 0", zIndex: 5 },
  tab: { flex: 1, padding: "9px 2px", border: "2px solid #10243E", background: "transparent", fontWeight: 700, fontSize: 11.5, cursor: "pointer", borderRadius: 999, color: "#10243E", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  tabOn: { background: "#10243E", color: "#F7F6F2" },
  card: { background: "#fff", border: "1.5px solid #E4E1D8", borderRadius: 14, padding: 16, marginBottom: 14 },
  h2: { fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 16, margin: "0 0 4px" },
  hint: { fontSize: 13, color: "#5B6472", margin: "4px 0 12px", lineHeight: 1.45 },
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 },
  rowLabel: { fontSize: 14, flex: 1 },
  inputWrap: { display: "flex", alignItems: "center", gap: 4, background: "#F7F6F2", borderRadius: 8, padding: "0 8px", border: "1.5px solid #E4E1D8" },
  unit: { color: "#5B6472", fontSize: 14 },
  input: { border: "none", background: "transparent", padding: "9px 2px", width: 84, fontSize: 15 },
  totalBlock: { borderTop: "2px dashed #E4E1D8", marginTop: 14, paddingTop: 14, textAlign: "center" },
  totalLabel: { fontSize: 12, textTransform: "uppercase", letterSpacing: 1.2, color: "#5B6472" },
  totalNum: { fontFamily: "'Archivo', sans-serif", fontWeight: 900, fontSize: 40, letterSpacing: -1 },
  badge: { display: "inline-block", color: "#fff", fontWeight: 700, fontSize: 13, borderRadius: 999, padding: "5px 14px", marginTop: 6 },
  refRow: { display: "flex", alignItems: "baseline", gap: 10, padding: "7px 0", borderBottom: "1px solid #F1EFE8", fontSize: 13.5 },
  refBig: { fontFamily: "'Archivo', sans-serif", fontWeight: 900, fontSize: 18, minWidth: 92 },
  lineHead: { display: "flex", alignItems: "center", gap: 10, marginBottom: 10 },
  lineBar: { width: 26, height: 8, borderRadius: 4, flexShrink: 0 },
  qRow: { display: "flex", gap: 10, alignItems: "flex-start", width: "100%", background: "transparent", border: "none", padding: "9px 2px", fontSize: 14.5, cursor: "pointer", color: "#10243E", borderBottom: "1px solid #F1EFE8", lineHeight: 1.4, transition: "opacity .15s" },
  tick: { width: 21, height: 21, borderRadius: 6, border: "2.5px solid", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, fontWeight: 900, marginTop: 1 },
  addBtn: { width: "100%", padding: 14, background: "#DC241F", color: "#fff", border: "none", borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: "pointer", marginBottom: 14, fontFamily: "'Archivo', sans-serif" },
  smallBtn: { background: "#10243E", color: "#fff", border: "none", borderRadius: 10, padding: "9px 16px", fontWeight: 800, fontSize: 13.5, cursor: "pointer", fontFamily: "'Archivo', sans-serif", flexShrink: 0 },
  propCard: { display: "block", width: "100%", textAlign: "left", background: "#fff", border: "1.5px solid #E4E1D8", borderRadius: 14, padding: 14, marginBottom: 10, cursor: "pointer", color: "#10243E" },
  compareRow: { display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #F1EFE8", fontSize: 14 },
  rank: { width: 22, height: 22, borderRadius: "50%", background: "#10243E", color: "#fff", fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  mono: { fontVariantNumeric: "tabular-nums", fontWeight: 600 },
  star: { background: "transparent", border: "none", fontSize: 30, cursor: "pointer", padding: "0 6px" },
  textarea: { width: "100%", border: "1.5px solid #E4E1D8", borderRadius: 10, padding: 10, fontSize: 14, background: "#F7F6F2", resize: "vertical" },
  backBtn: { background: "transparent", border: "none", color: "#0019A8", fontWeight: 700, cursor: "pointer", padding: 0, fontSize: 14 },
  deleteBtn: { marginTop: 16, background: "transparent", border: "1.5px solid #DC241F", color: "#DC241F", borderRadius: 10, padding: "8px 14px", fontWeight: 700, cursor: "pointer", fontSize: 13 },
  exportBtn: { width: "100%", padding: 13, background: "#10243E", color: "#F7F6F2", border: "none", borderRadius: 12, fontWeight: 800, fontSize: 14, cursor: "pointer", marginBottom: 12, fontFamily: "'Archivo', sans-serif" },
  starBtn: { background: "transparent", border: "none", fontSize: 24, cursor: "pointer", padding: "0 2px", lineHeight: 1 },
  roleChip: { fontSize: 11, fontWeight: 700, background: "#F1EFE8", color: "#5B6472", borderRadius: 999, padding: "2px 8px", verticalAlign: "middle", marginLeft: 4 },
  roleBtn: { border: "1.5px solid #E4E1D8", background: "transparent", borderRadius: 999, padding: "5px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: "#5B6472" },
  roleBtnOn: { background: "#10243E", borderColor: "#10243E", color: "#F7F6F2" },
  contactAction: { display: "inline-block", background: "#0019A8", color: "#fff", textDecoration: "none", fontWeight: 700, fontSize: 13, borderRadius: 999, padding: "7px 14px", marginBottom: 6 },
  thumb: { width: 86, height: 86, objectFit: "cover", borderRadius: 10, border: "1.5px solid #E4E1D8", display: "block" },
  thumbSm: { width: 52, height: 52, objectFit: "cover", borderRadius: 8, border: "1.5px solid #E4E1D8", flexShrink: 0 },
  thumbX: { position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: "50%", background: "#DC241F", color: "#fff", border: "none", fontWeight: 900, cursor: "pointer", lineHeight: 1, fontSize: 13 },
  thumbAdd: { width: 86, height: 86, borderRadius: 10, border: "2px dashed #C9C5BB", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, color: "#C9C5BB", cursor: "pointer" },
  footer: { fontSize: 11.5, color: "#5B6472", textAlign: "center", lineHeight: 1.6, marginTop: 8, padding: "0 10px" },
};
