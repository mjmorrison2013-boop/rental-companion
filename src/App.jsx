import React, { useState, useMemo, useEffect, useRef } from "react";

// ═══════════════════════════════════════════════════════════
// Rental Companion — v2.3 (2026-07-06 build, renamed from London Rental Companion)
// Tube-line nav · skyline header · listing import · TfL
// commutes · photos · shared hunts · affordability checks ·
// hunt map with area pins · daily snapshots + JSON backup/
// restore · permanent intro banner · passcode lock screen
// ═══════════════════════════════════════════════════════════

const LINES = {
  money: { name: "Money", color: "#DC241F" },
  tenancy: { name: "Tenancy", color: "#0019A8" },
  safety: { name: "Condition & Safety", color: "#00782A" },
  practical: { name: "Practicalities", color: "#E687A0" },
  share: { name: "House Shares", color: "#5BB8A0" },
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

const ZONE_COSTS = { "1-2": 171, "1-3": 201, "1-4": 246, "1-5": 292, "1-6": 313 };
const CONTACT_ROLES = ["Agent", "Landlord", "Flatmate", "Guarantor", "Other"];

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
    return { ok: true, site: site ? site.name : url.hostname.replace("www.", ""), id: idMatch ? idMatch[1] : null, url: url.href };
  } catch { return { ok: false }; }
};

const compressImage = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 640;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.62));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const emptyProperty = () => ({
  id: Date.now(), name: "", rent: "", rating: 0, checks: {}, notes: "",
  url: "", site: "", postcode: "", commute: null, photos: [],
  lat: null, lng: null, geoFail: false,
});

const STORE_KEY = "rental-companion-v2";
const SNAP_PREFIX = "rental-companion-snap-";
const loadState = () => {
  try {
    const raw = localStorage.getItem(STORE_KEY) || localStorage.getItem("rental-companion-v1");
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
};
const saved = loadState();

// ——— Data protection: rolling daily snapshots (photos excluded to save space) ———
const listSnapshots = () => {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(SNAP_PREFIX)) out.push(k.slice(SNAP_PREFIX.length));
    }
  } catch {}
  return out.sort().reverse(); // newest first
};
const takeDailySnapshot = (state) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const key = SNAP_PREFIX + today;
    if (localStorage.getItem(key)) return; // one per day
    const slim = { ...state, props: (state.props || []).map(({ photos, ...rest }) => rest) };
    localStorage.setItem(key, JSON.stringify(slim));
    // keep only the 3 most recent
    listSnapshots().slice(3).forEach((d) => localStorage.removeItem(SNAP_PREFIX + d));
  } catch {} // snapshot failure must never break the app
};

// ——— London skyline, drawn once, no image requests ———
const Skyline = ({ collapsed }) => (
  <svg viewBox="0 0 560 64" className={`skyline ${collapsed ? "skyline-off" : ""}`} aria-hidden="true" preserveAspectRatio="xMidYMax meet">
    <g fill="#10243E">
      {/* terraces */}
      <rect x="0" y="40" width="42" height="24" />
      <rect x="46" y="34" width="30" height="30" />
      {/* Battersea chimneys */}
      <rect x="84" y="38" width="44" height="26" />
      <rect x="86" y="26" width="5" height="14" /><rect x="121" y="26" width="5" height="14" />
      {/* Big Ben */}
      <rect x="150" y="18" width="12" height="46" />
      <polygon points="150,18 156,6 162,18" />
      <rect x="168" y="42" width="36" height="22" />
      {/* London Eye */}
      <circle cx="236" cy="38" r="20" fill="none" stroke="#10243E" strokeWidth="3" />
      <circle cx="236" cy="38" r="2.5" />
      <line x1="236" y1="38" x2="228" y2="64" stroke="#10243E" strokeWidth="3" />
      <line x1="236" y1="38" x2="244" y2="64" stroke="#10243E" strokeWidth="3" />
      {/* St Paul's */}
      <rect x="272" y="44" width="40" height="20" />
      <path d="M276 44 Q292 22 308 44 Z" />
      <rect x="290" y="16" width="4" height="10" />
      {/* Gherkin */}
      <path d="M336 64 Q332 34 346 20 Q360 34 356 64 Z" />
      {/* Shard */}
      <polygon points="384,64 398,4 412,64" />
      {/* Canary Wharf-ish blocks */}
      <rect x="428" y="24" width="26" height="40" />
      <rect x="458" y="34" width="20" height="30" />
      <rect x="482" y="28" width="24" height="36" />
      <rect x="510" y="42" width="50" height="22" />
    </g>
    {/* roundel sun */}
    <circle cx="522" cy="16" r="9" fill="none" stroke="#DC241F" strokeWidth="4" />
    <rect x="509" y="13.5" width="26" height="5" fill="#0019A8" />
  </svg>
);

// ——— Scroll-reveal wrapper ———
const Reveal = ({ children, delay = 0 }) => {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.classList.add("in");
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { el.classList.add("in"); io.disconnect(); } },
      { threshold: 0.08 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className="reveal" style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
};

// ——— Passcode (SHA-256 hashed, same approach as the F1 app lock screen) ———
const PIN_KEY = "rental-companion-pin";
const sha256 = async (text) => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((x) => x.toString(16).padStart(2, "0")).join("");
};
const storedPin = (() => { try { return localStorage.getItem(PIN_KEY); } catch { return null; } })();

// ——— Leaflet loaded on demand from CDN (no npm install needed) ———
const loadLeaflet = (() => {
  let p = null;
  return () => {
    if (window.L) return Promise.resolve(window.L);
    if (p) return p;
    p = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      document.head.appendChild(css);
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
      s.onload = () => resolve(window.L);
      s.onerror = () => reject(new Error("leaflet load failed"));
      document.head.appendChild(s);
    });
    return p;
  };
})();

const esc = (s) => String(s).replace(/</g, "&lt;").replace(/>/g, "&gt;");

const MapView = ({ properties, areaPins, addPin }) => {
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const addPinRef = useRef(addPin);
  addPinRef.current = addPin;
  const armedRef = useRef(false);
  const [armed, setArmed] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let dead = false;
    loadLeaflet()
      .then((L) => {
        if (dead || !divRef.current || mapRef.current) return;
        const map = L.map(divRef.current, { zoomControl: true }).setView([51.5074, -0.1276], 11);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19,
        }).addTo(map);
        map.on("click", (e) => {
          if (!armedRef.current) return;
          const name = window.prompt("Name this area — e.g. 'Peckham, near the park':");
          if (name && name.trim()) addPinRef.current(e.latlng.lat, e.latlng.lng, name.trim());
          armedRef.current = false;
          setArmed(false);
        });
        mapRef.current = map;
        layerRef.current = L.layerGroup().addTo(map);
        setReady(true);
      })
      .catch(() => setFailed(true));
    return () => { dead = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, []);

  useEffect(() => {
    const L = window.L;
    if (!ready || !L || !layerRef.current || !mapRef.current) return;
    layerRef.current.clearLayers();
    const pts = [];
    properties.filter((p) => p.lat && p.lng).forEach((p) => {
      const m = L.circleMarker([p.lat, p.lng], { radius: 10, color: "#DC241F", weight: 4, fillColor: "#fff", fillOpacity: 1 });
      m.bindPopup(
        `<strong>${esc(p.name || "Untitled")}</strong><br>` +
        `${p.rent ? "£" + esc(p.rent) + "/mo · " : ""}${"●".repeat(p.rating)}${"○".repeat(5 - p.rating)}` +
        (p.commute?.mins ? `<br>${p.commute.mins} min commute` : "")
      );
      m.addTo(layerRef.current);
      pts.push([p.lat, p.lng]);
    });
    areaPins.forEach((a) => {
      const m = L.circleMarker([a.lat, a.lng], { radius: 9, color: "#0019A8", weight: 4, fillColor: "#F3C623", fillOpacity: 1 });
      m.bindPopup(`<strong>${esc(a.name)}</strong><br>Area of interest`);
      m.addTo(layerRef.current);
      pts.push([a.lat, a.lng]);
    });
    if (pts.length) mapRef.current.fitBounds(pts, { padding: [34, 34], maxZoom: 14 });
  }, [ready, properties, areaPins]);

  if (failed) return <p style={{ fontSize: 13, color: "#5B6472" }}>The map couldn't load — check your connection and reopen this tab.</p>;

  return (
    <>
      <div ref={divRef} style={{ height: 400, borderRadius: 12, overflow: "hidden", border: "1.5px solid #E4E1D8", background: "#EDEBE4" }} />
      <button
        className="press"
        style={{
          width: "100%", marginTop: 10, padding: 12, borderRadius: 12, border: "none", cursor: "pointer",
          fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 14,
          background: armed ? "#F3C623" : "#0019A8", color: armed ? "#10243E" : "#fff",
        }}
        onClick={() => { armedRef.current = !armedRef.current; setArmed(armedRef.current); }}
      >
        {armed ? "Now tap the map where the area is… (tap here to cancel)" : "+ Drop an area pin"}
      </button>
    </>
  );
};

const STATIONS = [
  { key: "budget", label: "True Cost" },
  { key: "questions", label: "Questions" },
  { key: "properties", label: "Viewings" },
  { key: "map", label: "Map" },
  { key: "contacts", label: "Contacts" },
];

export default function App() {
  const [tab, setTabRaw] = useState("budget");
  const [ticked, setTicked] = useState(saved.ticked || {});
  const [props, setProps] = useState((saved.props || []).map((p) => ({ ...emptyProperty(), ...p, id: p.id })));
  const [active, setActive] = useState(null);
  const [exportText, setExportText] = useState("");
  const [copied, setCopied] = useState(false);
  const [contacts, setContacts] = useState(saved.contacts || []);
  const [editingContact, setEditingContact] = useState(null);
  const [anchor, setAnchor] = useState(saved.anchor || "");
  const [b, setB] = useState(saved.budget || { takeHome: "", rent: "", councilTax: "", bills: "150", travel: "120", broadband: "15", zone: "" });
  const [council, setCouncil] = useState({ postcode: "", result: null, busy: false });
  const [shareOpen, setShareOpen] = useState(false);
  const [importCode, setImportCode] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [storageWarn, setStorageWarn] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [areaPins, setAreaPins] = useState(saved.areaPins || []);
  const [pinHash, setPinHash] = useState(storedPin);
  const [locked, setLocked] = useState(!!storedPin);
  const [pinInput, setPinInput] = useState("");
  const [pinErr, setPinErr] = useState("");
  const [pinTries, setPinTries] = useState(0);
  const [coolUntil, setCoolUntil] = useState(0);
  const [securityOpen, setSecurityOpen] = useState(false);

  const tryUnlock = async () => {
    if (Date.now() < coolUntil) return;
    if (!/^\d{4}$/.test(pinInput)) { setPinErr("Enter your 4-digit passcode."); return; }
    if ((await sha256(pinInput)) === pinHash) {
      setLocked(false); setPinInput(""); setPinErr(""); setPinTries(0);
    } else {
      const tries = pinTries + 1;
      setPinTries(tries); setPinInput("");
      if (tries >= 5) { setCoolUntil(Date.now() + 30000); setPinErr("5 wrong attempts — locked for 30 seconds."); }
      else setPinErr(`Wrong passcode (${tries}/5).`);
    }
  };

  const setNewPin = async () => {
    const p1 = window.prompt(pinHash ? "Enter a NEW 4-digit passcode:" : "Choose a 4-digit passcode:");
    if (p1 === null) return;
    if (!/^\d{4}$/.test(p1)) { setProtectMsg("Passcode must be exactly 4 digits."); return; }
    const p2 = window.prompt("Type it again to confirm:");
    if (p2 !== p1) { setProtectMsg("Passcodes didn't match — nothing changed."); return; }
    const h = await sha256(p1);
    try { localStorage.setItem(PIN_KEY, h); } catch {}
    setPinHash(h);
    setProtectMsg("Passcode set. The app will ask for it whenever it's opened or locked.");
  };

  const removePin = async () => {
    const cur = window.prompt("Enter your current passcode to remove the lock:");
    if (cur === null) return;
    if ((await sha256(cur)) !== pinHash) { setProtectMsg("That's not the current passcode — lock unchanged."); return; }
    try { localStorage.removeItem(PIN_KEY); } catch {}
    setPinHash(null);
    setProtectMsg("Passcode removed — the app opens without a lock now.");
  };

  const forgotWipe = () => {
    const typed = window.prompt("Without the passcode, the only way back in is to erase everything on this device — viewings, photos, contacts, pins, and the lock itself. Snapshots are erased too.\n\nType ERASE to confirm:");
    if (typed !== "ERASE") return;
    try {
      localStorage.removeItem(STORE_KEY);
      localStorage.removeItem("rental-companion-v1");
      localStorage.removeItem(PIN_KEY);
      listSnapshots().forEach((d) => localStorage.removeItem(SNAP_PREFIX + d));
    } catch {}
    window.location.reload();
  };
  const [protectOpen, setProtectOpen] = useState(false);
  const [protectMsg, setProtectMsg] = useState("");
  const [snaps, setSnaps] = useState([]);
  const restoreInputRef = useRef(null);

  // One snapshot per day, taken on first load
  useEffect(() => {
    takeDailySnapshot({ ticked: saved.ticked, props: saved.props, contacts: saved.contacts, budget: saved.budget, anchor: saved.anchor, areaPins: saved.areaPins });
    setSnaps(listSnapshots());
  }, []);

  // Geocode any property with a postcode but no coordinates when the map opens
  useEffect(() => {
    if (tab !== "map") return;
    const need = props.filter((p) => p.postcode && p.postcode.trim() && !p.lat && !p.geoFail);
    if (!need.length) return;
    (async () => {
      try {
        const res = await fetch("https://api.postcodes.io/postcodes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postcodes: need.map((p) => p.postcode.trim()).slice(0, 100) }),
        });
        const data = await res.json();
        if (data.status !== 200) return;
        const norm = (s) => s.toLowerCase().replace(/\s/g, "");
        setProps((ps) =>
          ps.map((p) => {
            if (!p.postcode || p.lat || p.geoFail) return p;
            const hit = data.result.find((r) => norm(r.query) === norm(p.postcode));
            if (!hit) return p;
            return hit.result
              ? { ...p, lat: hit.result.latitude, lng: hit.result.longitude }
              : { ...p, geoFail: true };
          })
        );
      } catch {} // offline — pins appear next time the map opens
    })();
  }, [tab, props]);

  const addAreaPin = (lat, lng, name) => setAreaPins((a) => [...a, { id: Date.now(), lat, lng, name }]);
  const removeAreaPin = (id) => setAreaPins((a) => a.filter((x) => x.id !== id));

  const applyRestoredState = (data, keepPhotos) => {
    // Snapshots exclude photos — re-attach them from current state by property id
    const photoById = keepPhotos ? Object.fromEntries(props.map((p) => [p.id, p.photos])) : {};
    setTicked(data.ticked || {});
    setProps((data.props || []).map((p) => ({ ...emptyProperty(), ...p, photos: p.photos || photoById[p.id] || [] })));
    setContacts(data.contacts || []);
    setAreaPins(data.areaPins || []);
    setB(data.budget || { takeHome: "", rent: "", councilTax: "", bills: "150", travel: "120", broadband: "15", zone: "" });
    setAnchor(data.anchor || "");
    setActive(null);
  };

  const downloadBackup = () => {
    const payload = { app: "london-rental-companion", version: 2, exported: new Date().toISOString(), ticked, props, contacts, budget: b, anchor, areaPins };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `rental-companion-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setProtectMsg("Backup downloaded — save it to Google Drive or email it to yourself.");
  };

  const restoreFromFile = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.app !== "london-rental-companion") { setProtectMsg("That file isn't a rental companion backup."); return; }
        applyRestoredState(data, false);
        setProtectMsg(`Restored backup from ${data.exported ? data.exported.slice(0, 10) : "file"} — ${(data.props || []).length} viewings, ${(data.contacts || []).length} contacts.`);
      } catch {
        setProtectMsg("Couldn't read that file — make sure it's an unmodified backup JSON.");
      }
    };
    reader.readAsText(file);
  };

  const restoreSnapshot = (date) => {
    try {
      const raw = localStorage.getItem(SNAP_PREFIX + date);
      if (!raw) { setProtectMsg("That snapshot is gone."); return; }
      applyRestoredState(JSON.parse(raw), true);
      setProtectMsg(`Restored the ${date} snapshot (photos kept from current data).`);
    } catch {
      setProtectMsg("That snapshot couldn't be read.");
    }
  };

  const hardReset = () => {
    const typed = window.prompt('This deletes ALL viewings, photos, contacts, ticks and budget.\n\nA backup will download first. Type DELETE to confirm.');
    if (typed !== "DELETE") { setProtectMsg("Reset cancelled — nothing was deleted."); return; }
    downloadBackup(); // safety net, same as the F1 app
    try { localStorage.removeItem(STORE_KEY); localStorage.removeItem("rental-companion-v1"); } catch {}
    setTicked({}); setProps([]); setContacts([]); setActive(null); setAnchor(""); setAreaPins([]);
    setB({ takeHome: "", rent: "", councilTax: "", bills: "150", travel: "120", broadband: "15", zone: "" });
    setProtectMsg("Everything cleared. A backup was downloaded just in case — snapshots are still available above.");
  };

  const setTab = (k) => {
    setTabRaw(k);
    setActive(null);
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 36);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ ticked, props, contacts, budget: b, anchor, areaPins }));
      setStorageWarn(false);
    } catch { setStorageWarn(true); }
  }, [ticked, props, contacts, b, anchor, areaPins]);

  const num = (v) => parseFloat(v) || 0;
  const trueCost = num(b.rent) + num(b.councilTax) + num(b.bills) + num(b.travel) + num(b.broadband);
  const pct = num(b.takeHome) > 0 ? Math.round((trueCost / num(b.takeHome)) * 100) : null;
  const upfront = num(b.rent) > 0 ? Math.round(num(b.rent) * (1 + 5 / 4.33)) : 0;
  const reqSalary = num(b.rent) > 0 ? Math.round(num(b.rent) * 30) : 0;
  const reqGuarantor = num(b.rent) > 0 ? Math.round(num(b.rent) * 36) : 0;

  const doneCount = Object.values(ticked).filter(Boolean).length;
  const updateProp = (id, patch) => setProps((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const activeProp = props.find((p) => p.id === active);
  const sorted = useMemo(() => [...props].sort((a, z) => z.rating - a.rating), [props]);
  const updateContact = (id, patch) => setContacts((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const sortedContacts = [...contacts].sort((a, z) => (z.fav ? 1 : 0) - (a.fav ? 1 : 0));
  const emptyContact = () => ({ id: Date.now(), name: "", role: "Agent", phone: "", email: "", fav: false, note: "" });

  const [pasteUrl, setPasteUrl] = useState("");
  const importListing = () => {
    const r = parseListing(pasteUrl);
    if (!r.ok) { setImportMsg("That doesn't look like a valid link."); return; }
    const p = { ...emptyProperty(), url: r.url, site: r.site, name: r.site + (r.id ? " #" + r.id.slice(-5) : "") };
    setProps((ps) => [...ps, p]);
    setPasteUrl("");
    setActive(p.id);
  };

  const planCommute = async (p) => {
    if (!p.postcode.trim() || !anchor.trim()) return;
    updateProp(p.id, { commute: { busy: true } });
    try {
      const res = await fetch(`https://api.tfl.gov.uk/Journey/JourneyResults/${encodeURIComponent(p.postcode.trim())}/to/${encodeURIComponent(anchor.trim())}`);
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

  const lookupCouncil = async () => {
    if (!council.postcode.trim()) return;
    setCouncil((c) => ({ ...c, busy: true, result: null }));
    try {
      const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(council.postcode.trim())}`);
      const data = await res.json();
      setCouncil((c) => ({ ...c, busy: false, result: data.status === 200 ? { district: data.result.admin_district, ok: true } : { ok: false } }));
    } catch {
      setCouncil((c) => ({ ...c, busy: false, result: { ok: false } }));
    }
  };

  const addPhotos = async (p, files) => {
    const room = 3 - p.photos.length;
    const list = Array.from(files).slice(0, room);
    const done = [];
    for (const f of list) { try { done.push(await compressImage(f)); } catch {} }
    if (done.length) updateProp(p.id, { photos: [...p.photos, ...done] });
  };

  const buildShareCode = () => {
    const slim = props.map(({ photos, ...rest }) => rest);
    return btoa(unescape(encodeURIComponent(JSON.stringify({ v: 2, props: slim, contacts, areaPins }))));
  };
  const importHunt = () => {
    try {
      const data = JSON.parse(decodeURIComponent(escape(atob(importCode.trim()))));
      const existing = new Set(props.map((p) => p.name + "|" + p.rent));
      const incoming = (data.props || []).filter((p) => !existing.has(p.name + "|" + p.rent))
        .map((p, i) => ({ ...emptyProperty(), ...p, id: Date.now() + i, photos: [] }));
      const existingC = new Set(contacts.map((c) => c.name + "|" + c.phone));
      const incomingC = (data.contacts || []).filter((c) => !existingC.has(c.name + "|" + c.phone))
        .map((c, i) => ({ ...c, id: Date.now() + 1000 + i }));
      const existingA = new Set(areaPins.map((a) => a.name));
      const incomingA = (data.areaPins || []).filter((a) => !existingA.has(a.name))
        .map((a, i) => ({ ...a, id: Date.now() + 2000 + i }));
      setProps([...props, ...incoming]);
      setContacts([...contacts, ...incomingC]);
      setAreaPins([...areaPins, ...incomingA]);
      setImportMsg(`Imported ${incoming.length} viewing${incoming.length === 1 ? "" : "s"}, ${incomingC.length} contact${incomingC.length === 1 ? "" : "s"} and ${incomingA.length} area pin${incomingA.length === 1 ? "" : "s"}.`);
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

  if (locked) {
    return (
      <div style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@700;900&family=Public+Sans:wght@400;600&display=swap');
          * { box-sizing: border-box; }
          input:focus, button:focus-visible { outline: 3px solid #DC241F33; outline-offset: 1px; }
        `}</style>
        <div style={S.lockCard}>
          <div style={{ ...S.roundel, margin: "0 auto 14px" }}>
            <div style={S.roundelBar}>FLAT&nbsp;FINDER</div>
          </div>
          <h1 style={{ ...S.h1, textAlign: "center", fontSize: 19 }}>Rental Companion</h1>
          <p style={{ ...S.hint, textAlign: "center" }}>Enter your passcode to open your hunt.</p>
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            autoFocus
            value={pinInput}
            onChange={(e) => { setPinInput(e.target.value.replace(/\D/g, "")); setPinErr(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") tryUnlock(); }}
            style={S.pinInput}
            aria-label="4-digit passcode"
          />
          <button className="press" style={{ ...S.addBtn, marginTop: 14 }} onClick={tryUnlock} disabled={Date.now() < coolUntil}>
            Unlock
          </button>
          {pinErr && <p style={{ ...S.hint, color: "#DC241F", textAlign: "center", marginBottom: 0 }}>{pinErr}</p>}
          <button style={{ background: "transparent", border: "none", color: "#5B6472", textDecoration: "underline", fontSize: 11.5, cursor: "pointer", display: "block", margin: "14px auto 0" }}
            onClick={forgotWipe}>
            Forgot passcode?
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;900&family=Public+Sans:wght@400;600&display=swap');
        * { box-sizing: border-box; }
        button, input, textarea { font-family: inherit; }
        input:focus, textarea:focus, button:focus-visible { outline: 3px solid #DC241F33; outline-offset: 1px; }

        .skyline { display: block; width: 100%; height: 58px; max-height: 58px; opacity: .16; transition: max-height .35s ease, opacity .35s ease; }
        .skyline-off { max-height: 0; opacity: 0; }

        .reveal { opacity: 0; transform: translateY(14px); transition: opacity .5s ease, transform .5s ease; }
        .reveal.in { opacity: 1; transform: none; }

        .press { transition: transform .12s ease, box-shadow .12s ease; }
        .press:active { transform: scale(.97); }

        .card-lift { transition: transform .18s ease, box-shadow .18s ease; }
        .card-lift:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(16,36,62,.10); }

        .tickpop { animation: pop .25s ease; }
        @keyframes pop { 0% { transform: scale(.6); } 60% { transform: scale(1.15); } 100% { transform: scale(1); } }

        .station-nav { position: sticky; top: 0; z-index: 6; background: rgba(247,246,242,.97); padding: 10px 0; margin-bottom: 12px; }
        .station-line { display: flex; gap: 7px; }
        .station { position: relative; flex: 1; background: #fff; border: 2px solid #10243E; border-radius: 13px; cursor: pointer; padding: 11px 2px 9px; color: #10243E; min-height: 58px; -webkit-tap-highlight-color: transparent; transition: transform .15s ease, background .15s ease, color .15s ease, box-shadow .15s ease; }
        .station:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(16,36,62,.15); }
        .station:active { transform: scale(.96); }
        .station.on { background: #10243E; color: #F7F6F2; box-shadow: 0 4px 14px rgba(16,36,62,.28); }
        .station.on::after { content: ""; position: absolute; left: 18%; right: 18%; bottom: 5px; height: 4px; background: #DC241F; border-radius: 2px; }
        .station-label { display: block; font-family: 'Archivo', sans-serif; font-size: 12.5px; font-weight: 800; letter-spacing: .02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .station.on .station-label { font-weight: 900; }
        .station-count { font-family: 'Public Sans', sans-serif; font-size: 10px; font-weight: 700; color: #fff; background: #DC241F; border-radius: 999px; padding: 1px 7px; display: inline-block; margin-top: 4px; min-height: 14px; }
        .station.on .station-count { background: #DC241F; }
        .station-count:empty { background: transparent; padding: 0; }

        .hero-img { width: calc(100% + 32px); margin: -16px -16px 12px; height: 170px; object-fit: cover; border-radius: 12.5px 12.5px 0 0; display: block; }
        .hero-wrap { position: relative; }
        .hero-name { position: absolute; left: 0; right: 16px; bottom: 12px; padding: 8px 14px; color: #fff; font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 19px; text-shadow: 0 1px 8px rgba(0,0,0,.55); pointer-events: none; }

        @media (prefers-reduced-motion: reduce) {
          * { transition: none !important; animation: none !important; }
          .reveal { opacity: 1; transform: none; }
        }
      `}</style>

      {/* Header with skyline that compresses on scroll */}
      <header style={{ ...S.header, paddingBottom: scrolled ? 4 : 0, transition: "padding .3s ease" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ ...S.roundel, transform: scrolled ? "scale(.8)" : "none", transition: "transform .3s ease" }}>
            <div style={S.roundelBar}>FLAT&nbsp;FINDER</div>
          </div>
          <div>
            <h1 style={S.h1}>Rental Companion</h1>
            <p style={S.sub}>Budget it. Ask it. Score it.</p>
          </div>
        </div>
        <Skyline collapsed={scrolled} />
      </header>

      <div style={S.introBanner}>
        <div style={S.introKicker}>Mind the gap between the advert and reality</div>
        <p style={{ ...S.introText, marginBottom: 2 }}>
          Your London flat-hunt sidekick. Work out what a place <strong>really</strong> costs each month,
          walk into every viewing knowing exactly what to ask, score and compare the flats you see,
          and keep every agent one tap away. Everything saves privately on this device.
        </p>
      </div>

      {storageWarn && (
        <div style={S.warnBanner}>Storage is full — new changes may not save. Try removing some photos from older viewings.</div>
      )}

      {/* Tube-line navigation */}
      <nav className="station-nav" aria-label="Sections">
        <div className="station-line">
          {STATIONS.map((s) => {
            const count = s.key === "questions" && doneCount > 0 ? `${doneCount}/${QUESTIONS.length}`
              : s.key === "properties" && props.length > 0 ? props.length
              : s.key === "contacts" && contacts.length > 0 ? contacts.length : "";
            return (
              <button key={s.key} className={`station ${tab === s.key ? "on" : ""}`} onClick={() => setTab(s.key)} aria-current={tab === s.key}>
                <span className="station-label">{s.label}</span>
                <span className="station-count">{count}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* ═══ TRUE COST ═══ */}
      {tab === "budget" && (
        <>
          <Reveal>
            <section style={S.card} className="card-lift">
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
                    <button key={z} className="press" onClick={() => setB({ ...b, travel: String(cost), zone: z })}
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
                {upfront > 0 && <p style={S.hint}>Cash needed upfront (first month + 5-week deposit): <strong>≈ £{upfront.toLocaleString()}</strong></p>}
              </div>
            </section>
          </Reveal>

          {reqSalary > 0 && (
            <Reveal delay={60}>
              <section style={S.card} className="card-lift">
                <h2 style={S.h2}>Will you pass referencing?</h2>
                <p style={S.hint}>Most agents require one of these for a £{num(b.rent).toLocaleString()}/month rent:</p>
                <div style={S.refRow}><span style={S.refBig}>£{reqSalary.toLocaleString()}</span> your annual salary (30× monthly rent)</div>
                <div style={S.refRow}><span style={S.refBig}>£{reqGuarantor.toLocaleString()}</span> or a UK guarantor's salary (36×)</div>
                <div style={S.refRow}><span style={S.refBig}>£{Math.round(num(b.rent) * 6).toLocaleString()}+</span> or 6–12 months' rent upfront</div>
                <p style={{ ...S.hint, marginBottom: 0 }}>Job offer letters usually count as proof of income — ask the agent before assuming you need a guarantor.</p>
              </section>
            </Reveal>
          )}

          <Reveal delay={100}>
            <section style={S.card} className="card-lift">
              <h2 style={S.h2}>Which council is it?</h2>
              <p style={S.hint}>Council tax varies a lot between boroughs. Look up the borough, then check its band rates on the council's site.</p>
              <div style={{ display: "flex", gap: 8 }}>
                <input style={S.textInput} placeholder="Postcode, e.g. SE15 4QL" value={council.postcode}
                  onChange={(e) => setCouncil({ ...council, postcode: e.target.value })} />
                <button className="press" style={S.smallBtn} onClick={lookupCouncil} disabled={council.busy}>
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
          </Reveal>
        </>
      )}

      {/* ═══ QUESTIONS ═══ */}
      {tab === "questions" && (
        <section>
          {Object.entries(LINES).map(([key, line], gi) => (
            <Reveal key={key} delay={gi * 50}>
              <div style={S.card}>
                <div style={S.lineHead}>
                  <span style={{ ...S.lineBar, background: line.color }} />
                  <h2 style={S.h2}>{line.name}</h2>
                </div>
                {QUESTIONS.filter((q) => q.line === key).map((q, i) => {
                  const id = key + i;
                  const on = !!ticked[id];
                  return (
                    <button key={id} onClick={() => setTicked({ ...ticked, [id]: !on })} style={{ ...S.qRow, opacity: on ? 0.45 : 1 }}>
                      <span className={on ? "tickpop" : ""} style={{ ...S.tick, borderColor: line.color, background: on ? line.color : "transparent" }}>{on ? "✓" : ""}</span>
                      <span style={{ textDecoration: on ? "line-through" : "none", textAlign: "left" }}>{q.t}</span>
                    </button>
                  );
                })}
              </div>
            </Reveal>
          ))}
        </section>
      )}

      {/* ═══ VIEWINGS LIST ═══ */}
      {tab === "properties" && !activeProp && (
        <section>
          <Reveal>
            <div style={S.card} className="card-lift">
              <h2 style={S.h2}>Add from a listing link</h2>
              <p style={S.hint}>Paste a Rightmove, Zoopla, SpareRoom or OpenRent link — it becomes a viewing with the link saved.</p>
              <div style={{ display: "flex", gap: 8 }}>
                <input style={S.textInput} placeholder="https://www.rightmove.co.uk/properties/…" value={pasteUrl}
                  onChange={(e) => { setPasteUrl(e.target.value); setImportMsg(""); }} />
                <button className="press" style={S.smallBtn} onClick={importListing}>Add</button>
              </div>
              {importMsg && <p style={{ ...S.hint, marginTop: 8, marginBottom: 0 }}>{importMsg}</p>}
            </div>
          </Reveal>

          <Reveal delay={50}>
            <div style={S.card}>
              <label style={S.row}>
                <span style={S.rowLabel}><strong>Commute anchor</strong> — work/uni postcode for travel times</span>
                <input style={{ ...S.textInput, flex: "0 0 120px", width: 120 }} placeholder="EC2A 4BX" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
              </label>
            </div>
          </Reveal>

          <Reveal delay={90}>
            <button className="press" style={S.addBtn} onClick={() => { const p = emptyProperty(); setProps([...props, p]); setActive(p.id); }}>
              + Add a viewing manually
            </button>
          </Reveal>

          {sorted.length > 1 && (
            <Reveal delay={110}>
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
            </Reveal>
          )}

          {props.map((p, i) => (
            <Reveal key={p.id} delay={i * 40}>
              <button style={S.propCard} className="card-lift press" onClick={() => setActive(p.id)}>
                <div style={{ display: "flex", gap: 12 }}>
                  {p.photos[0]
                    ? <img src={p.photos[0]} alt="" style={S.thumbSm} />
                    : <div style={S.thumbPlaceholder}>{(p.name || "?").slice(0, 1).toUpperCase()}</div>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 17 }}>{p.name || "Untitled viewing"}</div>
                    <div style={S.hint}>
                      {p.rent ? `£${p.rent}/mo · ` : ""}
                      {p.commute?.mins ? `${p.commute.mins} min commute · ` : ""}
                      <span style={{ color: "#DC241F" }}>{"●".repeat(p.rating)}</span>{"○".repeat(5 - p.rating)} · {Object.values(p.checks).filter(Boolean).length}/{SPOT_CHECKS.length} checks
                    </div>
                  </div>
                </div>
              </button>
            </Reveal>
          ))}

          {props.length === 0 && (
            <p style={{ ...S.hint, textAlign: "center", marginTop: 24 }}>
              No viewings yet. Paste a listing link above, or add one manually before you walk through the door.
            </p>
          )}

          {props.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <button className="press" style={S.exportBtn} onClick={handleExport}>{copied ? "✓ Copied to clipboard" : "Export notes as text"}</button>
              {exportText && (
                <div style={S.card}>
                  <p style={S.hint}>{copied ? "Copied — paste it into Notes, WhatsApp, or an email to yourself." : "Tap the box, select all, and copy."}</p>
                  <textarea readOnly style={{ ...S.textarea, fontFamily: "ui-monospace, monospace", fontSize: 12.5 }}
                    rows={Math.min(16, exportText.split("\n").length)} value={exportText} onFocus={(e) => e.target.select()} />
                </div>
              )}
            </div>
          )}

          <button className="press" style={{ ...S.exportBtn, background: "#0019A8", marginTop: 4 }} onClick={() => { setShareOpen(!shareOpen); setImportMsg(""); }}>
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
              <button className="press" style={{ ...S.smallBtn, marginTop: 8 }} onClick={importHunt}>Import their hunt</button>
              {importMsg && <p style={{ ...S.hint, marginTop: 8, marginBottom: 0 }}>{importMsg}</p>}
            </div>
          )}
        </section>
      )}

      {/* ═══ SINGLE PROPERTY ═══ */}
      {tab === "properties" && activeProp && (
        <Reveal>
          <section style={S.card}>
            {activeProp.photos[0] && (
              <div className="hero-wrap">
                <img src={activeProp.photos[0]} alt="" className="hero-img" />
                {activeProp.name && <div className="hero-name">{activeProp.name}</div>}
              </div>
            )}
            <button style={S.backBtn} onClick={() => setActive(null)}>← All viewings</button>
            <input style={{ ...S.textInput, width: "100%", fontSize: 18, fontWeight: 700, marginTop: 10 }}
              placeholder="Nickname — e.g. 'Peckham blue door'" value={activeProp.name}
              onChange={(e) => updateProp(activeProp.id, { name: e.target.value })} />

            {activeProp.url && (
              <a href={activeProp.url} target="_blank" rel="noreferrer" style={{ ...S.contactAction, marginTop: 10 }} className="press">
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

            <div style={S.sectionLabel}>Commute</div>
            {!anchor.trim() ? (
              <p style={S.hint}>Set your work/uni postcode on the viewings page first, then check travel time from here.</p>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8 }}>
                  <input style={S.textInput} placeholder="This property's postcode" value={activeProp.postcode}
                    onChange={(e) => updateProp(activeProp.id, { postcode: e.target.value })} />
                  <button className="press" style={S.smallBtn} onClick={() => planCommute(activeProp)} disabled={activeProp.commute?.busy}>
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

            <div style={S.sectionLabel}>Photos <span style={{ fontWeight: 400, color: "#5B6472", fontSize: 12 }}>({activeProp.photos.length}/3)</span></div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {activeProp.photos.map((src, i) => (
                <div key={i} style={{ position: "relative" }}>
                  <img src={src} alt={`Photo ${i + 1}`} style={S.thumb} />
                  <button style={S.thumbX} aria-label="Remove photo"
                    onClick={() => updateProp(activeProp.id, { photos: activeProp.photos.filter((_, j) => j !== i) })}>×</button>
                </div>
              ))}
              {activeProp.photos.length < 3 && (
                <label style={S.thumbAdd} className="press">
                  +
                  <input type="file" accept="image/*" multiple style={{ display: "none" }}
                    onChange={(e) => { addPhotos(activeProp, e.target.files); e.target.value = ""; }} />
                </label>
              )}
            </div>
            <p style={{ ...S.hint, marginTop: 6 }}>Snap the damp patch, the boiler, the view — whatever you'll forget by viewing #4. The first photo becomes this page's banner.</p>

            <div style={S.sectionLabel}>Gut rating</div>
            <div>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} className="press" onClick={() => updateProp(activeProp.id, { rating: n })}
                  style={{ ...S.star, color: n <= activeProp.rating ? "#DC241F" : "#C9C5BB" }} aria-label={`Rate ${n} of 5`}>●</button>
              ))}
            </div>

            <div style={S.sectionLabel}>Spot checks</div>
            {SPOT_CHECKS.map((c, i) => {
              const on = !!activeProp.checks[i];
              return (
                <button key={i} style={{ ...S.qRow, opacity: on ? 0.5 : 1 }}
                  onClick={() => updateProp(activeProp.id, { checks: { ...activeProp.checks, [i]: !on } })}>
                  <span className={on ? "tickpop" : ""} style={{ ...S.tick, borderColor: "#10243E", background: on ? "#10243E" : "transparent" }}>{on ? "✓" : ""}</span>
                  <span style={{ textAlign: "left" }}>{c}</span>
                </button>
              );
            })}

            <div style={S.sectionLabel}>Notes</div>
            <textarea style={S.textarea} rows={4} placeholder="Smell? Flatmates? What did the agent dodge?"
              value={activeProp.notes} onChange={(e) => updateProp(activeProp.id, { notes: e.target.value })} />

            <button className="press" style={S.deleteBtn} onClick={() => { setProps(props.filter((p) => p.id !== activeProp.id)); setActive(null); }}>
              Delete this viewing
            </button>
          </section>
        </Reveal>
      )}

      {/* ═══ MAP ═══ */}
      {tab === "map" && (
        <section>
          <Reveal>
            <div style={S.card}>
              <h2 style={S.h2}>Hunt map</h2>
              <p style={S.hint}>
                Every viewing with a postcode is pinned automatically —
                <span style={{ whiteSpace: "nowrap" }}> <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#fff", border: "3px solid #DC241F", verticalAlign: "middle" }} /> red roundels</span> are your viewings,
                <span style={{ whiteSpace: "nowrap" }}> <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#F3C623", border: "3px solid #0019A8", verticalAlign: "middle" }} /> gold pins</span> are areas you're tracking.
                Tap a pin for details. Add a postcode on a viewing's page to put it on the map.
              </p>
              <MapView properties={props} areaPins={areaPins} addPin={addAreaPin} />
            </div>
          </Reveal>

          {areaPins.length > 0 && (
            <Reveal delay={60}>
              <div style={S.card}>
                <h2 style={S.h2}>Areas you're tracking</h2>
                {areaPins.map((a) => (
                  <div key={a.id} style={S.compareRow}>
                    <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#F3C623", border: "3px solid #0019A8", flexShrink: 0 }} />
                    <span style={{ flex: 1, fontWeight: 600 }}>{a.name}</span>
                    <button className="press" style={{ ...S.backBtn, color: "#DC241F" }} onClick={() => removeAreaPin(a.id)}>Remove</button>
                  </div>
                ))}
              </div>
            </Reveal>
          )}
        </section>
      )}

      {/* ═══ CONTACTS ═══ */}
      {tab === "contacts" && (
        <section>
          <Reveal>
            <button className="press" style={S.addBtn} onClick={() => { const c = emptyContact(); setContacts([...contacts, c]); setEditingContact(c.id); }}>
              + Add a contact
            </button>
          </Reveal>
          {contacts.length === 0 && (
            <p style={{ ...S.hint, textAlign: "center", marginTop: 24 }}>
              Save agents, landlords and potential flatmates here. Star your favourites so they float to the top.
            </p>
          )}
          {sortedContacts.map((c, i) => {
            const editing = editingContact === c.id;
            return (
              <Reveal key={c.id} delay={i * 40}>
                <div style={S.card} className="card-lift">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button className="press" onClick={() => updateContact(c.id, { fav: !c.fav })}
                      style={{ ...S.starBtn, color: c.fav ? "#DC241F" : "#C9C5BB" }}
                      aria-label={c.fav ? "Remove from favourites" : "Add to favourites"}>★</button>
                    {editing ? (
                      <input style={{ ...S.textInput, flex: 1, width: "auto", fontWeight: 700, fontSize: 16 }}
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
                          <button key={r} className="press" onClick={() => updateContact(c.id, { role: r })}
                            style={{ ...S.roleBtn, ...(c.role === r ? S.roleBtnOn : {}) }}>{r}</button>
                        ))}
                      </div>
                      <label style={S.row}>
                        <span style={S.rowLabel}>Phone</span>
                        <input inputMode="tel" style={{ ...S.textInput, flex: "0 0 170px", width: 170 }}
                          value={c.phone} onChange={(e) => updateContact(c.id, { phone: e.target.value })} placeholder="07…" />
                      </label>
                      <label style={S.row}>
                        <span style={S.rowLabel}>Email</span>
                        <input inputMode="email" style={{ ...S.textInput, flex: "0 0 170px", width: 170 }}
                          value={c.email} onChange={(e) => updateContact(c.id, { email: e.target.value })} placeholder="name@…" />
                      </label>
                      <textarea style={{ ...S.textarea, marginTop: 4 }} rows={2}
                        placeholder="Note — e.g. 'handles the Peckham flat, responsive on WhatsApp'"
                        value={c.note} onChange={(e) => updateContact(c.id, { note: e.target.value })} />
                      <button className="press" style={S.deleteBtn} onClick={() => { setContacts(contacts.filter((x) => x.id !== c.id)); setEditingContact(null); }}>
                        Delete contact
                      </button>
                    </div>
                  ) : (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {c.phone && <a href={`tel:${c.phone.replace(/\s/g, "")}`} style={S.contactAction} className="press">Call {c.phone}</a>}
                        {c.email && <a href={`mailto:${c.email}`} style={S.contactAction} className="press">Email</a>}
                      </div>
                      {c.note && <p style={{ ...S.hint, marginBottom: 0 }}>{c.note}</p>}
                      {!c.phone && !c.email && !c.note && <p style={{ ...S.hint, marginBottom: 0 }}>No details yet — tap Edit.</p>}
                    </div>
                  )}
                </div>
              </Reveal>
            );
          })}
        </section>
      )}

      {/* ═══ DATA PROTECTION (always visible, mirrors the F1 app toolbar) ═══ */}
      <div style={S.protectBar}>
        <span style={S.protectLabel}>Data Protection</span>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <button className="press" style={S.protectBtn} onClick={downloadBackup} title="Download a JSON backup of everything">⬇ Backup</button>
          <button className="press" style={S.protectBtn} onClick={() => { setProtectOpen(!protectOpen); setSecurityOpen(false); setSnaps(listSnapshots()); setProtectMsg(""); }}>↺ Restore</button>
          <button className="press" style={S.protectBtn} onClick={() => { setSecurityOpen(!securityOpen); setProtectOpen(false); setProtectMsg(""); }}>🔒 Security</button>
          <button className="press" style={{ ...S.protectBtn, color: "#DC241F" }} onClick={hardReset}>⚠ Reset</button>
        </div>
      </div>
      {protectMsg && <p style={{ ...S.hint, textAlign: "center" }}>{protectMsg}</p>}
      {securityOpen && (
        <div style={S.card}>
          <h2 style={S.h2}>Passcode lock</h2>
          <p style={S.hint}>
            {pinHash
              ? "A passcode is set — the app asks for it on every open. Handy if you lend your phone at a viewing."
              : "Add a 4-digit passcode so your viewings, photos and notes don't open for whoever picks up your phone."}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="press" style={S.smallBtn} onClick={setNewPin}>{pinHash ? "Change passcode" : "Set a passcode"}</button>
            {pinHash && <button className="press" style={S.smallBtn} onClick={() => setLocked(true)}>Lock now</button>}
            {pinHash && <button className="press" style={{ ...S.smallBtn, background: "transparent", color: "#DC241F", border: "1.5px solid #DC241F" }} onClick={removePin}>Remove passcode</button>}
          </div>
          <p style={{ ...S.hint, marginTop: 12, marginBottom: 0 }}>
            Honest limits: this deters casual snooping on this device. It isn't encryption — someone with full access
            to the phone's files could still read the data, and backup files you download are unlocked. Treat those like any private document.
          </p>
        </div>
      )}
      {protectOpen && (
        <div style={S.card}>
          <h2 style={S.h2}>Restore</h2>
          <p style={S.hint}>Automatic snapshots are taken once a day on this device (photos aren't snapshotted, but they're kept when you restore). For anything bigger, restore from a downloaded backup file.</p>
          {snaps.length === 0 && <p style={S.hint}>No snapshots on this device yet — one is taken automatically each day you open the app.</p>}
          {snaps.map((d) => (
            <div key={d} style={S.compareRow}>
              <span style={{ flex: 1, fontWeight: 600 }}>{d}</span>
              <button className="press" style={S.smallBtn} onClick={() => restoreSnapshot(d)}>Restore</button>
            </div>
          ))}
          <div style={{ marginTop: 14, fontWeight: 700 }}>Restore from a backup file</div>
          <input ref={restoreInputRef} type="file" accept=".json,application/json" style={{ display: "none" }}
            onChange={(e) => { if (e.target.files[0]) restoreFromFile(e.target.files[0]); e.target.value = ""; }} />
          <button className="press" style={{ ...S.smallBtn, marginTop: 8 }} onClick={() => restoreInputRef.current?.click()}>Choose backup file…</button>
        </div>
      )}

      <footer style={S.footer}>
        Deposit cap: 5 weeks · Holding deposit: 1 week max · Admin fees: illegal ·
        Deposit must be protected within 30 days. Check shelter.org.uk before signing.
        Travelcard figures are estimates — verify at tfl.gov.uk.
      </footer>
    </div>
  );
}

const S = {
  page: { fontFamily: "'Public Sans', system-ui, sans-serif", background: "#F7F6F2", minHeight: "100vh", color: "#10243E", maxWidth: 560, margin: "0 auto", padding: "0 14px 40px" },
  header: { padding: "20px 2px 0" },
  roundel: { width: 58, height: 58, borderRadius: "50%", border: "7px solid #DC241F", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: "#F7F6F2", transformOrigin: "left center" },
  roundelBar: { background: "#0019A8", color: "#fff", fontFamily: "'Archivo', sans-serif", fontWeight: 900, fontSize: 7.5, letterSpacing: 0.5, padding: "3px 6px", whiteSpace: "nowrap" },
  h1: { fontFamily: "'Archivo', sans-serif", fontWeight: 900, fontSize: 22, margin: 0, letterSpacing: -0.3 },
  sub: { margin: "2px 0 0", fontSize: 13, color: "#5B6472" },
  warnBanner: { background: "#B26300", color: "#fff", fontSize: 12.5, fontWeight: 600, borderRadius: 10, padding: "8px 12px", marginBottom: 10 },
  card: { background: "#fff", border: "1.5px solid #E4E1D8", borderRadius: 14, padding: 16, marginBottom: 14 },
  h2: { fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 16, margin: "0 0 4px" },
  hint: { fontSize: 13, color: "#5B6472", margin: "4px 0 12px", lineHeight: 1.45 },
  sectionLabel: { margin: "18px 0 6px", fontWeight: 800, fontFamily: "'Archivo', sans-serif", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.8, color: "#10243E" },
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 },
  rowLabel: { fontSize: 14, flex: 1 },
  inputWrap: { display: "flex", alignItems: "center", gap: 4, background: "#F7F6F2", borderRadius: 8, padding: "0 8px", border: "1.5px solid #E4E1D8" },
  unit: { color: "#5B6472", fontSize: 14 },
  input: { border: "none", background: "transparent", padding: "9px 2px", width: 84, fontSize: 15 },
  textInput: { flex: 1, width: "auto", background: "#F7F6F2", borderRadius: 8, padding: "9px 10px", border: "1.5px solid #E4E1D8", fontSize: 15 },
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
  addBtn: { width: "100%", padding: 14, background: "#DC241F", color: "#fff", border: "none", borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: "pointer", marginBottom: 14, fontFamily: "'Archivo', sans-serif", boxShadow: "0 3px 10px rgba(220,36,31,.25)" },
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
  thumbSm: { width: 56, height: 56, objectFit: "cover", borderRadius: 10, border: "1.5px solid #E4E1D8", flexShrink: 0 },
  thumbPlaceholder: { width: 56, height: 56, borderRadius: 10, background: "#10243E", color: "#F7F6F2", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Archivo', sans-serif", fontWeight: 900, fontSize: 20, flexShrink: 0 },
  thumbX: { position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: "50%", background: "#DC241F", color: "#fff", border: "none", fontWeight: 900, cursor: "pointer", lineHeight: 1, fontSize: 13 },
  thumbAdd: { width: 86, height: 86, borderRadius: 10, border: "2px dashed #C9C5BB", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, color: "#C9C5BB", cursor: "pointer" },
  footer: { fontSize: 11.5, color: "#5B6472", textAlign: "center", lineHeight: 1.6, marginTop: 8, padding: "0 10px" },
  protectBar: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", background: "#fff", border: "1.5px solid #E4E1D8", borderRadius: 14, padding: "10px 14px", marginTop: 20, marginBottom: 10 },
  protectLabel: { fontFamily: "'Archivo', sans-serif", fontWeight: 900, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 1.4, color: "#5B6472" },
  protectBtn: { background: "transparent", border: "none", fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.8, color: "#10243E", cursor: "pointer", padding: "4px 0" },
  introBanner: { background: "#10243E", color: "#F7F6F2", borderRadius: 16, padding: "18px 18px 16px", marginBottom: 14, borderBottom: "6px solid #DC241F" },
  introKicker: { fontFamily: "'Archivo', sans-serif", fontWeight: 900, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.6, color: "#F3C623", marginBottom: 8 },
  introText: { fontSize: 14.5, lineHeight: 1.55, margin: "0 0 12px", color: "#E8E6DF" },
  lockCard: { background: "#fff", border: "1.5px solid #E4E1D8", borderRadius: 18, padding: "30px 26px", width: "100%", maxWidth: 340, boxShadow: "0 10px 30px rgba(16,36,62,.10)" },
  pinInput: { display: "block", width: 150, margin: "6px auto 0", textAlign: "center", fontSize: 30, letterSpacing: 14, fontFamily: "'Archivo', sans-serif", fontWeight: 900, background: "#F7F6F2", border: "1.5px solid #E4E1D8", borderRadius: 12, padding: "10px 0 10px 14px", color: "#10243E" },
};
