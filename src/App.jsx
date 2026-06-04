import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  LayoutDashboard, Wallet, ListChecks, Target, Sparkles, Plus, Trash2,
  TrendingUp, AlertTriangle, CheckCircle2, Info, PiggyBank, Home,
  Plane, Hammer, ShieldCheck, ArrowRight, Pencil, X, GraduationCap,
  BookOpen, Coffee, Lightbulb, ChevronRight, Settings, Briefcase, Landmark,
  RefreshCw, HandCoins, BellRing, CalendarClock, Download, Upload,
  Search, ArrowUpDown, ArrowDownUp, ChevronDown, ChevronUp
} from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, Legend, LineChart, Line, AreaChart, Area
} from "recharts";

/* ============================================================
   PASTEL DESIGN TOKENS
   ============================================================ */
const C = {
  bg: "#FBF8F4",
  card: "#FFFFFF",
  ink: "#3A3A4A",
  inkSoft: "#7B7B8E",
  inkFaint: "#A8A8B8",
  line: "#EFE9E1",
  // pastels
  lav: "#C9C2F0", lavDeep: "#7F77C4", lavBg: "#F0EEFB",
  mint: "#B6E3D4", mintDeep: "#4FA88A", mintBg: "#E7F5F0",
  peach: "#F6C9B6", peachDeep: "#D6845E", peachBg: "#FBEBE3",
  sky: "#B7D6F0", skyDeep: "#5B8FC4", skyBg: "#E8F1FA",
  rose: "#F2C2D2", roseDeep: "#C97B98", roseBg: "#FBEAF0",
  butter: "#F4DCA0", butterDeep: "#C99F3F", butterBg: "#FBF2D9",
  sage: "#CFE0B4", sageDeep: "#84A155", sageBg: "#F0F4E6",
};

const CATEGORY_PALETTE = [
  { key: "lav", dot: C.lav, deep: C.lavDeep, bg: C.lavBg },
  { key: "mint", dot: C.mint, deep: C.mintDeep, bg: C.mintBg },
  { key: "peach", dot: C.peach, deep: C.peachDeep, bg: C.peachBg },
  { key: "sky", dot: C.sky, deep: C.skyDeep, bg: C.skyBg },
  { key: "rose", dot: C.rose, deep: C.roseDeep, bg: C.roseBg },
  { key: "butter", dot: C.butter, deep: C.butterDeep, bg: C.butterBg },
  { key: "sage", dot: C.sage, deep: C.sageDeep, bg: C.sageBg },
];

/* ============================================================
   PERSISTENT STORAGE LAYER (window.storage)
   ============================================================ */
const STORE_KEY = "budgetbuddy:state:v1";

async function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.error("Load failed:", e); }
  return null;
}

async function saveState(state) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) { console.error("Save failed:", e); }
}

/* ============================================================
   SINGAPORE FINANCE LOGIC
   ============================================================ */
// CPF allocation for employees aged <=55 (2024/25 rates)
// Employee contributes 20% of wage; employer 17%. Total 37%.
// Of total: ~62.17% to OA, ~16.21% to SA, ~21.62% to MA (for age <=35 band, simplified)
function cpfBreakdown(grossMonthly) {
  const capped = Math.min(grossMonthly, 7400); // 2025 OW ceiling
  const employee = capped * 0.20;
  const employer = capped * 0.17;
  const total = employee + employer;
  return {
    takeHome: grossMonthly - employee,
    employeeCpf: employee,
    employerCpf: employer,
    totalCpf: total,
    oa: total * 0.6217,
    sa: total * 0.1621,
    ma: total * 0.2162,
  };
}

// Resolve which salary applies for a given month (YYYY-MM).
// Looks through salaryRecords; falls back to legacy state.profile.grossSalary.
// Returns { amount, type, takeHome, grossWithCpf, isFromRecord }.
function salaryForMonth(state, monthStr) {
  const records = state.salaryRecords || [];
  // Find matching record(s); if multiple cover this month, use the most recently created one.
  const matching = records.filter((r) => {
    if (!r.fromMonth) return false;
    if (monthStr < r.fromMonth) return false;
    if (r.untilMonth && monthStr > r.untilMonth) return false;
    return true;
  });
  if (matching.length > 0) {
    // Sort by id (timestamp-based) so latest entry wins on overlap.
    const r = matching.sort((a, b) => b.id.localeCompare(a.id))[0];
    if (r.type === "withoutCpf") {
      return { amount: r.amount, type: "withoutCpf", takeHome: r.amount,
        grossWithCpf: 0, isFromRecord: true };
    } else {
      const cpf = cpfBreakdown(r.amount);
      return { amount: r.amount, type: "withCpf", takeHome: cpf.takeHome,
        grossWithCpf: r.amount, isFromRecord: true };
    }
  }
  // Legacy fallback: treat profile.grossSalary as "withCpf"
  const legacy = state.profile.grossSalary || 0;
  const cpf = cpfBreakdown(legacy);
  return { amount: legacy, type: "withCpf", takeHome: cpf.takeHome,
    grossWithCpf: legacy, isFromRecord: false };
}

/* Asset types for the net-worth profile. Liquidity flags whether the money
   is readily spendable — used to size the emergency fund correctly. */
const ASSET_TYPES = [
  { key: "savings", label: "Savings account", icon: "💰", liquid: true, pal: 1 },
  { key: "fd", label: "Fixed deposit", icon: "🏦", liquid: false, pal: 3 },
  { key: "investments", label: "Investments", icon: "📈", liquid: false, pal: 0 },
  { key: "cpf", label: "CPF balance", icon: "🇸🇬", liquid: false, pal: 6 },
  { key: "cash", label: "Cash on hand", icon: "💵", liquid: true, pal: 5 },
  { key: "other", label: "Other", icon: "📦", liquid: false, pal: 4 },
];
function assetType(key) {
  return ASSET_TYPES.find((a) => a.key === key) || ASSET_TYPES[5];
}

const DEFAULT_STATE = {
  onboarded: false,
  // "offline" = free, self-contained knowledge base (works after Pro ends, zero token cost)
  // "ai" = calls Anthropic API for richer answers (needs Pro / API access)
  coachMode: "offline",
  profile: {
    name: "",
    grossSalary: 0,
    monthlyIncomeOther: 0,
    currentSavings: 0,
    startWorkMonth: "",
  },
  // Salary change log — appended every time salary is updated, newest first.
  // (Legacy format: { id, date, from, to, reason }. Kept for backwards compat.)
  salaryHistory: [],
  // Salary records — each entry specifies an amount, type (withCpf/withoutCpf),
  // and a month range it applies to. Newest records override overlapping older ones.
  // Each: { id, amount, type, fromMonth (YYYY-MM), untilMonth (YYYY-MM or "") }
  salaryRecords: [],
  // Current assets across all account types — stored locally only.
  assets: [],
  // Envelope budget categories (50/30/20-inspired but editable)
  envelopes: [
    { id: "e1", name: "Rent / Housing", budget: 0, spent: 0, pal: 0, type: "need" },
    { id: "e2", name: "Food & Groceries", budget: 0, spent: 0, pal: 1, type: "need" },
    { id: "e3", name: "Transport", budget: 0, spent: 0, pal: 2, type: "need" },
    { id: "e4", name: "Bills & Subscriptions", budget: 0, spent: 0, pal: 3, type: "need" },
    { id: "e5", name: "Dining & Fun", budget: 0, spent: 0, pal: 4, type: "want" },
    { id: "e6", name: "Shopping", budget: 0, spent: 0, pal: 5, type: "want" },
    { id: "e7", name: "Savings & Invest", budget: 0, spent: 0, pal: 6, type: "save" },
  ],
  transactions: [],
  goals: [
    { id: "g1", name: "Emergency Fund", target: 0, saved: 0, icon: "shield", deadline: "", note: "3-6 months of expenses. Build this FIRST." },
  ],
  chatHistory: [],
  monthlySnapshots: [],
  // Money owed TO the user — IOUs, lent cash, fronted shared bills.
  reminders: [],
  // Recurring subscriptions with renewal/deduction dates.
  subscriptions: [],
  // Free-form personal notes on the Goals page.
  goalNotes: "",
};

/* ============================================================
   ROOT
   ============================================================ */
export default function App() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("dashboard");

  useEffect(() => {
    (async () => {
      const saved = await loadState();
      setState(saved || DEFAULT_STATE);
      setLoading(false);
    })();
  }, []);

  // debounced persistence
  useEffect(() => {
    if (!state || loading) return;
    const t = setTimeout(() => saveState(state), 400);
    return () => clearTimeout(t);
  }, [state, loading]);

  // Seed pre-configured reminders (only once, uses deterministic IDs).
  useEffect(() => {
    if (!state || loading || !state.onboarded) return;
    const existing = new Set((state.reminders || []).map((r) => r.id));
    const seeds = [];
    if (!existing.has("seed_chatgpt")) {
      seeds.push({
        id: "seed_chatgpt", who: "Hall ppl (6)", purpose: "ChatGPT Plus",
        amount: 24.60, dueDate: "2026-06-15", frequency: "monthly",
        endDate: "", settled: false,
      });
    }
    if (!existing.has("seed_spotify")) {
      seeds.push({
        id: "seed_spotify", who: "Spotify family (5)", purpose: "Spotify family plan",
        amount: 215.70, dueDate: "2026-09-01", frequency: "yearly",
        endDate: "", settled: false,
      });
    }
    if (seeds.length === 0) return;
    update((s) => ({ ...s, reminders: [...seeds, ...(s.reminders || [])] }));
  }, [state?.onboarded, loading]);

  // Auto-record subscription payments when billing dates have passed.
  // Runs once after load and whenever subscriptions change. Uses deterministic
  // transaction IDs (sub ID + date) to prevent double-recording.
  useEffect(() => {
    if (!state || loading || !state.onboarded) return;
    const subs = state.subscriptions || [];
    const activeSubs = subs.filter((s) => s.active !== false && s.nextRenew);
    if (activeSubs.length === 0) return;

    const subsEnv = state.envelopes.find((e) =>
      e.name.toLowerCase().includes("subscription") || e.name.toLowerCase().includes("bills"));
    const fallbackEnvId = subsEnv ? subsEnv.id : (state.envelopes[0]?.id || "");
    const existingTxnIds = new Set((state.transactions || []).map((t) => t.id));
    const todayStr = todayISO();

    let newTxns = [];
    let envSpendDeltas = {}; // envId -> amount to add
    let subUpdates = {}; // subId -> new nextRenew

    activeSubs.forEach((sub) => {
      let renewDate = sub.nextRenew;
      const cycleKey = sub.cycle === "yearly" ? "monthly" : sub.cycle; // yearly subs billed once, advance by cycle
      const advanceKey = sub.cycle; // use actual cycle for advancing
      let guard = 0;

      // Walk forward through each missed billing date.
      while (daysUntil(renewDate) <= 0 && guard < 60) {
        // Deterministic ID: prevents re-recording if app re-opens on the same day.
        const txnId = `autosub_${sub.id}_${renewDate}`;
        if (!existingTxnIds.has(txnId)) {
          newTxns.push({
            id: txnId,
            desc: `${sub.name} (auto-recorded)`,
            amount: sub.cost,
            envId: fallbackEnvId,
            date: renewDate,
            type: "expense",
          });
          existingTxnIds.add(txnId);
          envSpendDeltas[fallbackEnvId] = (envSpendDeltas[fallbackEnvId] || 0) + sub.cost;
        }
        // Advance to next billing date.
        renewDate = advanceDate(renewDate, advanceKey === "yearly" ? "monthly" : advanceKey);
        // For yearly subs, jump 12 months.
        if (advanceKey === "yearly") {
          const d = new Date(renewDate);
          d.setMonth(d.getMonth() + 11); // already advanced 1 month, add 11 more
          renewDate = d.toISOString().slice(0, 10);
        }
        guard++;
      }
      if (renewDate !== sub.nextRenew) {
        subUpdates[sub.id] = renewDate;
      }
    });

    if (newTxns.length === 0 && Object.keys(subUpdates).length === 0) return;

    update((s) => ({
      ...s,
      transactions: [...newTxns.reverse(), ...s.transactions],
      envelopes: s.envelopes.map((e) =>
        envSpendDeltas[e.id] ? { ...e, spent: e.spent + envSpendDeltas[e.id] } : e),
      subscriptions: s.subscriptions.map((sub) =>
        subUpdates[sub.id] ? { ...sub, nextRenew: subUpdates[sub.id] } : sub),
    }));
  }, [state?.subscriptions?.length, loading]); // re-check when subs are added/removed

  const update = useCallback((fn) => {
    setState((prev) => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      return next;
    });
  }, []);

  if (loading || !state) {
    return (
      <div style={{ ...sx.app, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 400 }}>
        <div style={{ textAlign: "center", color: C.inkSoft }}>
          <PiggyBank size={40} color={C.lavDeep} />
          <p style={{ marginTop: 12, fontSize: 14 }}>Loading your finances…</p>
        </div>
      </div>
    );
  }

  if (!state.onboarded) {
    return <Onboarding state={state} update={update} />;
  }

  const TABS = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "envelopes", label: "Envelopes", icon: Wallet },
    { id: "ledger", label: "Ledger", icon: ListChecks },
    { id: "subs", label: "Subs", icon: RefreshCw },
    { id: "owed", label: "Owed", icon: HandCoins },
    { id: "goals", label: "Goals", icon: Target },
    { id: "coach", label: "Coach", icon: Sparkles },
  ];

  return (
    <div style={sx.app}>
      <style>{globalCss}</style>
      <Header state={state} update={update} />
      <nav style={sx.nav}>
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                ...sx.navBtn,
                background: active ? C.lavDeep : "transparent",
                color: active ? "#fff" : C.inkSoft,
                boxShadow: active ? "0 4px 12px rgba(127,119,196,0.32)" : "none",
              }}
            >
              <Icon size={16} />
              <span className="navLabel">{t.label}</span>
            </button>
          );
        })}
      </nav>

      <main style={sx.main}>
        {tab === "dashboard" && <Dashboard state={state} update={update} goTo={setTab} />}
        {tab === "envelopes" && <Envelopes state={state} update={update} />}
        {tab === "ledger" && <Ledger state={state} update={update} />}
        {tab === "subs" && <Subscriptions state={state} update={update} />}
        {tab === "owed" && <Owed state={state} update={update} />}
        {tab === "goals" && <Goals state={state} update={update} />}
        {tab === "coach" && <Coach state={state} update={update} />}
      </main>
      <footer style={sx.footer}>
        Educational tool for personal planning — not licensed financial advice. Verify CPF & investment details with official sources.
      </footer>
    </div>
  );
}

/* ============================================================
   ONBOARDING
   ============================================================ */
function Onboarding({ state, update }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: "", grossSalary: "", startWorkMonth: "",
    assetAmounts: {}, // keyed by asset type
  });

  const totalAssets = Object.values(form.assetAmounts).reduce((a, v) => a + (Number(v) || 0), 0);
  // Liquid assets = the cash that can actually back an emergency fund.
  const liquidAssets = ASSET_TYPES.filter((t) => t.liquid)
    .reduce((a, t) => a + (Number(form.assetAmounts[t.key]) || 0), 0);

  const finish = () => {
    const gross = Number(form.grossSalary) || 0;
    const cpf = cpfBreakdown(gross);
    const takeHome = cpf.takeHome;
    const needs = takeHome * 0.5;
    const wants = takeHome * 0.3;
    const save = takeHome * 0.2;
    const envelopes = [
      { id: "e1", name: "Rent / Housing", budget: Math.round(needs * 0.45), spent: 0, pal: 0, type: "need" },
      { id: "e2", name: "Food & Groceries", budget: Math.round(needs * 0.3), spent: 0, pal: 1, type: "need" },
      { id: "e3", name: "Transport", budget: Math.round(needs * 0.13), spent: 0, pal: 2, type: "need" },
      { id: "e4", name: "Bills & Subscriptions", budget: Math.round(needs * 0.12), spent: 0, pal: 3, type: "need" },
      { id: "e5", name: "Dining & Fun", budget: Math.round(wants * 0.55), spent: 0, pal: 4, type: "want" },
      { id: "e6", name: "Shopping", budget: Math.round(wants * 0.45), spent: 0, pal: 5, type: "want" },
      { id: "e7", name: "Savings & Invest", budget: Math.round(save), spent: 0, pal: 6, type: "save" },
    ];
    // Turn the entered amounts into asset records.
    const assets = ASSET_TYPES
      .filter((t) => Number(form.assetAmounts[t.key]) > 0)
      .map((t) => ({
        id: "a" + t.key, type: t.key, label: t.label,
        amount: Number(form.assetAmounts[t.key]),
      }));
    update({
      ...state,
      onboarded: true,
      profile: {
        name: form.name || "there",
        grossSalary: gross,
        monthlyIncomeOther: 0,
        currentSavings: liquidAssets,
        startWorkMonth: form.startWorkMonth,
      },
      assets,
      salaryHistory: gross > 0
        ? [{ id: "sh0", date: new Date().toISOString().slice(0, 10), from: 0, to: gross, reason: "Starting salary" }]
        : [],
      envelopes,
      goals: [
        {
          id: "g1", name: "Emergency Fund", icon: "shield",
          target: Math.round(needs * 6),
          saved: liquidAssets, // only liquid cash counts toward the safety net
          deadline: "", note: "3-6 months of expenses. Build this FIRST, before investing.",
        },
      ],
    });
  };

  const cpf = form.grossSalary ? cpfBreakdown(Number(form.grossSalary)) : null;
  const setAsset = (key, val) =>
    setForm({ ...form, assetAmounts: { ...form.assetAmounts, [key]: val } });

  return (
    <div style={{ ...sx.app, minHeight: 520 }}>
      <style>{globalCss}</style>
      <div style={sx.onbWrap}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <div style={sx.logoMark}><PiggyBank size={22} color="#fff" /></div>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, color: C.ink }}>BudgetBuddy SG</h1>
            <p style={{ margin: 0, fontSize: 12.5, color: C.inkSoft }}>Your personal money companion</p>
          </div>
        </div>

        <div style={sx.onbDots}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ ...sx.onbDot, background: i <= step ? C.lavDeep : C.line }} />
          ))}
        </div>

        {step === 0 && (
          <div style={sx.onbCard}>
            <span style={sx.onbBadge}><GraduationCap size={13} /> Welcome</span>
            <h2 style={sx.onbH2}>Let's set you up for your first job</h2>
            <p style={sx.onbP}>
              This tool grows with you — from tracking daily kopi spends to planning a BTO down payment.
              It's built for Singapore, so it understands CPF, and it's designed for someone just starting out.
              Nothing here leaves your device.
            </p>
            <Field label="What should I call you?">
              <input style={sx.input} value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Your name" />
            </Field>
            <button style={sx.primaryBtn} onClick={() => setStep(1)}>
              Get started <ArrowRight size={16} />
            </button>
          </div>
        )}

        {step === 1 && (
          <div style={sx.onbCard}>
            <span style={sx.onbBadge}><Wallet size={13} /> Your income</span>
            <h2 style={sx.onbH2}>Expected monthly salary</h2>
            <p style={sx.onbP}>
              Enter your <strong>gross</strong> monthly salary (before CPF). Not sure yet?
              The 2024 median fresh-grad starting salary was around $4,000–$4,500 — use an estimate, you can change it anytime.
            </p>
            <Field label="Gross monthly salary (SGD)">
              <input style={sx.input} type="number" value={form.grossSalary}
                onChange={(e) => setForm({ ...form, grossSalary: e.target.value })}
                placeholder="e.g. 4200" />
            </Field>
            <Field label="When do you start work?">
              <input style={sx.input} type="month" value={form.startWorkMonth}
                onChange={(e) => setForm({ ...form, startWorkMonth: e.target.value })} />
            </Field>

            {cpf && cpf.takeHome > 0 && (
              <div style={sx.cpfBox}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <Info size={14} color={C.skyDeep} />
                  <strong style={{ fontSize: 13, color: C.ink }}>How CPF affects your paycheck</strong>
                </div>
                <p style={{ fontSize: 12.5, color: C.inkSoft, margin: "0 0 10px", lineHeight: 1.6 }}>
                  As an employee, 20% of your wage goes to CPF. Your employer adds 17% on top. That money isn't gone —
                  it's split into accounts you'll use for housing, healthcare, and retirement.
                </p>
                <div style={sx.cpfGrid}>
                  <CpfStat label="Cash take-home" val={cpf.takeHome} accent={C.mintDeep} big />
                  <CpfStat label="To CPF (you)" val={cpf.employeeCpf} accent={C.inkSoft} />
                  <CpfStat label="OA — housing" val={cpf.oa} accent={C.skyDeep} />
                  <CpfStat label="SA — retirement" val={cpf.sa} accent={C.lavDeep} />
                  <CpfStat label="MA — healthcare" val={cpf.ma} accent={C.peachDeep} />
                </div>
                <p style={{ fontSize: 11.5, color: C.inkFaint, margin: "10px 0 0", lineHeight: 1.5 }}>
                  Your <strong>Ordinary Account (OA)</strong> is what funds a future BTO flat — so CPF is
                  quietly helping you save for that already.
                </p>
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button style={sx.ghostBtn} onClick={() => setStep(0)}>Back</button>
              <button style={{ ...sx.primaryBtn, opacity: form.grossSalary ? 1 : 0.5 }}
                disabled={!form.grossSalary} onClick={() => setStep(2)}>
                Continue <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={sx.onbCard}>
            <span style={sx.onbBadge}><PiggyBank size={13} /> Your starting point</span>
            <h2 style={sx.onbH2}>What have you saved so far?</h2>
            <p style={sx.onbP}>
              Enter what you have in each place. Leave anything blank if it doesn't apply —
              even all-zero is a perfectly fine start. This stays on your device only.
            </p>

            {ASSET_TYPES.map((t) => (
              <div key={t.key} style={{ marginBottom: 10 }}>
                <label style={sx.label}>
                  {t.icon} {t.label}
                  {t.liquid && <span style={sx.liquidTag}>counts for emergencies</span>}
                </label>
                <input style={sx.input} type="number"
                  value={form.assetAmounts[t.key] || ""}
                  onChange={(e) => setAsset(t.key, e.target.value)}
                  placeholder="0" />
              </div>
            ))}

            {totalAssets > 0 && (
              <div style={{ ...sx.cpfBox, background: C.mintBg }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: C.inkSoft, fontWeight: 700 }}>Total net worth</span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: C.mintDeep }}>
                    ${Math.round(totalAssets).toLocaleString()}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, color: C.inkFaint }}>Liquid (emergency-ready)</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.skyDeep }}>
                    ${Math.round(liquidAssets).toLocaleString()}
                  </span>
                </div>
              </div>
            )}

            <div style={sx.tipBox}>
              <Lightbulb size={15} color={C.butterDeep} />
              <p style={{ margin: 0, fontSize: 12.5, color: C.ink, lineHeight: 1.6 }}>
                I'll create an <strong>emergency fund</strong> goal worth ~6 months of expenses.
                Only your <strong>liquid</strong> savings (savings account, cash) count toward it —
                fixed deposits and investments aren't quickly spendable in a crisis.
              </p>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button style={sx.ghostBtn} onClick={() => setStep(1)}>Back</button>
              <button style={sx.primaryBtn} onClick={finish}>
                Open my dashboard <CheckCircle2 size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CpfStat({ label, val, accent, big }) {
  return (
    <div style={{ background: "#fff", borderRadius: 10, padding: "8px 10px", border: `1px solid ${C.line}` }}>
      <div style={{ fontSize: 10.5, color: C.inkFaint, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: big ? 16 : 13.5, fontWeight: 700, color: accent }}>
        ${Math.round(val).toLocaleString()}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={sx.label}>{label}</label>
      {children}
    </div>
  );
}

/* ============================================================
   HEADER
   ============================================================ */
function Header({ state, update }) {
  const [open, setOpen] = useState(false);
  return (
    <header style={sx.header}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={sx.logoMark}><PiggyBank size={20} color="#fff" /></div>
        <div>
          <h1 style={{ margin: 0, fontSize: 16.5, color: C.ink, letterSpacing: -0.2 }}>BudgetBuddy SG</h1>
          <p style={{ margin: 0, fontSize: 11.5, color: C.inkSoft }}>
            Hi {state.profile.name} — let's keep it on track
          </p>
        </div>
      </div>
      <button style={sx.iconBtn} onClick={() => setOpen(!open)} aria-label="Settings">
        <Settings size={17} color={C.inkSoft} />
      </button>
      {open && <SettingsPanel state={state} update={update} close={() => setOpen(false)} />}
    </header>
  );
}

function SettingsPanel({ state, update, close }) {
  const [salaryType, setSalaryType] = useState("withCpf"); // "withCpf" or "withoutCpf"
  const [amount, setAmount] = useState("");
  const [fromMonth, setFromMonth] = useState(currentMonthStr());
  const [untilMonth, setUntilMonth] = useState("");
  const records = state.salaryRecords || [];

  const addRecord = () => {
    const num = Number(amount);
    if (!num || num <= 0 || !fromMonth) return;
    const rec = {
      id: "sr" + Date.now(),
      amount: num,
      type: salaryType,
      fromMonth,
      untilMonth: untilMonth || "",
    };
    update((s) => ({
      ...s,
      salaryRecords: [rec, ...(s.salaryRecords || [])],
      // Also update profile.grossSalary to the latest "withCpf" amount, so legacy
      // displays (onboarding CPF box, etc.) stay sensible.
      profile: salaryType === "withCpf"
        ? { ...s.profile, grossSalary: num }
        : s.profile,
    }));
    setAmount("");
    setUntilMonth("");
  };

  const deleteRecord = (id) => {
    update((s) => ({ ...s, salaryRecords: (s.salaryRecords || []).filter((r) => r.id !== id) }));
  };

  // Preview: what does this salary translate to as take-home?
  const previewTakeHome = (() => {
    const num = Number(amount) || 0;
    if (!num) return null;
    if (salaryType === "withoutCpf") return num;
    return cpfBreakdown(num).takeHome;
  })();

  return (
    <div style={sx.modalOverlay} onClick={close}>
      <div style={{ ...sx.modal, width: 360, maxHeight: "85vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: C.ink }}>Settings</h3>
          <button style={sx.iconBtn} onClick={close}><X size={16} color={C.inkSoft} /></button>
        </div>

        <div style={{ ...sx.eduStrip, marginBottom: 12 }}>
          <Briefcase size={14} color={C.lavDeep} />
          <span>Add a salary record for any month range. Every tab calculates against the right
            salary for whichever month you're viewing.</span>
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: C.inkSoft, marginBottom: 8 }}>
          Salary type
        </div>
        <div style={{ display: "flex", gap: 5, marginBottom: 12 }}>
          <button onClick={() => setSalaryType("withCpf")} style={{
            ...sx.chip, fontSize: 11,
            background: salaryType === "withCpf" ? C.lavDeep : C.lavBg,
            color: salaryType === "withCpf" ? "#fff" : C.lavDeep,
          }}>With CPF deduction</button>
          <button onClick={() => setSalaryType("withoutCpf")} style={{
            ...sx.chip, fontSize: 11,
            background: salaryType === "withoutCpf" ? C.lavDeep : C.lavBg,
            color: salaryType === "withoutCpf" ? "#fff" : C.lavDeep,
          }}>No CPF deduction</button>
        </div>
        <p style={{ fontSize: 11, color: C.inkFaint, margin: "0 0 12px", lineHeight: 1.5 }}>
          {salaryType === "withCpf"
            ? "Your gross salary; CPF (20%) is deducted to give take-home."
            : "Your full monthly income with no CPF deduction (e.g. allowance, freelance, internship)."}
        </p>

        <Field label={salaryType === "withCpf" ? "Gross monthly salary with CPF (SGD)" : "Monthly income without CPF (SGD)"}>
          <input style={sx.input} type="number" value={amount}
            onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 2000" />
        </Field>

        {previewTakeHome !== null && (
          <div style={{ ...sx.tipBox, background: C.skyBg, margin: "0 0 12px" }}>
            <Info size={14} color={C.skyDeep} />
            <p style={{ margin: 0, fontSize: 12, color: C.ink, lineHeight: 1.5 }}>
              Take-home: <strong>${Math.round(previewTakeHome).toLocaleString()}/mo</strong>
              {salaryType === "withCpf" && ` (after $${Math.round(cpfBreakdown(Number(amount)).employeeCpf).toLocaleString()} CPF)`}
              . This is what every tab uses for the months below.
            </p>
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <Field label="From month">
            <input style={sx.input} type="month" value={fromMonth}
              onChange={(e) => setFromMonth(e.target.value)} />
          </Field>
          <Field label="Until month (optional)">
            <input style={sx.input} type="month" value={untilMonth}
              onChange={(e) => setUntilMonth(e.target.value)} />
          </Field>
        </div>
        <p style={{ fontSize: 10.5, color: C.inkFaint, margin: "-8px 0 12px" }}>
          Leave "until" blank if this salary is ongoing. Newer records override older ones for overlapping months.
        </p>

        <button style={{ ...sx.primaryBtn, opacity: amount && fromMonth ? 1 : 0.5 }}
          disabled={!amount || !fromMonth} onClick={addRecord}>
          <Plus size={14} /> Save salary record
        </button>

        {records.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.inkSoft, marginBottom: 8 }}>
              Salary records ({records.length})
            </div>
            {records.sort((a, b) => b.fromMonth.localeCompare(a.fromMonth)).map((r) => (
              <div key={r.id} style={{ ...sx.histRow, alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>
                    ${Math.round(r.amount).toLocaleString()}
                    <span style={{ fontSize: 10, fontWeight: 600, color: C.inkFaint, marginLeft: 5 }}>
                      {r.type === "withCpf" ? "with CPF" : "no CPF"}
                    </span>
                  </div>
                  <div style={{ fontSize: 10.5, color: C.inkSoft, marginTop: 2 }}>
                    {fmtMonthShort(r.fromMonth)} – {r.untilMonth ? fmtMonthShort(r.untilMonth) : "ongoing"}
                  </div>
                  <div style={{ fontSize: 10, color: C.mintDeep, marginTop: 2, fontWeight: 700 }}>
                    Take-home: ${Math.round(r.type === "withCpf" ? cpfBreakdown(r.amount).takeHome : r.amount).toLocaleString()}/mo
                  </div>
                </div>
                <button style={sx.miniIconBtn} onClick={() => deleteRecord(r.id)} aria-label="Delete">
                  <Trash2 size={13} color={C.inkFaint} />
                </button>
              </div>
            ))}
          </div>
        )}

        <BackupSection state={state} update={update} close={close} />
      </div>
    </div>
  );
}

/* ============================================================
   BACKUP — JSON export / import for moving between devices
   ============================================================ */
function BackupSection({ state, update, close }) {
  const fileRef = React.useRef(null);
  const [msg, setMsg] = useState(null);

  const doExport = () => {
    try {
      const payload = {
        app: "BudgetBuddy SG",
        version: 1,
        exportedAt: new Date().toISOString(),
        data: state,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `budgetbuddy-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMsg({ ok: true, text: "Backup file downloaded." });
    } catch (e) {
      setMsg({ ok: false, text: "Export failed — try again." });
    }
  };

  const doImport = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        // Accept either a wrapped export or a raw state object.
        const incoming = parsed && parsed.data ? parsed.data : parsed;
        if (!incoming || typeof incoming !== "object" || !("envelopes" in incoming)) {
          throw new Error("shape");
        }
        if (!confirm("Importing will replace all current data on this device with the backup. Continue?")) {
          return;
        }
        // Merge onto DEFAULT_STATE so any newer fields missing from an old
        // backup get sensible defaults instead of undefined.
        update({ ...DEFAULT_STATE, ...incoming, onboarded: true });
        setMsg({ ok: true, text: "Backup restored. Reopening…" });
        setTimeout(close, 900);
      } catch (err) {
        setMsg({ ok: false, text: "That file isn't a valid BudgetBuddy backup." });
      }
    };
    reader.onerror = () => setMsg({ ok: false, text: "Couldn't read that file." });
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.inkSoft, marginBottom: 6 }}>
        Backup &amp; transfer
      </div>
      <p style={{ fontSize: 11.5, color: C.inkFaint, margin: "0 0 10px", lineHeight: 1.5 }}>
        Your data lives only in this browser. Export a backup file to keep it safe or move it
        to another device, then import it there.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={{ ...sx.softBtn, flex: 1 }} onClick={doExport}>
          <Download size={13} /> Export backup
        </button>
        <button style={{ ...sx.softBtn, flex: 1 }} onClick={() => fileRef.current && fileRef.current.click()}>
          <Upload size={13} /> Import backup
        </button>
      </div>
      <input ref={fileRef} type="file" accept="application/json,.json"
        onChange={doImport} style={{ display: "none" }} />
      {msg && (
        <p style={{
          fontSize: 11, margin: "8px 0 0", fontWeight: 600,
          color: msg.ok ? C.mintDeep : C.roseDeep,
        }}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

/* ============================================================
   INSIGHT ENGINE — shared by Dashboard & Coach
   Generates personalised flags & suggestions
   ============================================================ */
function buildInsights(state, monthStr) {
  const targetMonth = monthStr || currentMonthStr();
  const sal = salaryForMonth(state, targetMonth);
  // Synthesise cpf info for the resolved salary (for AI coach context).
  const cpf = sal.type === "withCpf" ? cpfBreakdown(sal.amount)
    : { takeHome: sal.amount, employeeCpf: 0, employerCpf: 0, totalCpf: 0, oa: 0, sa: 0, ma: 0 };
  const income = sal.takeHome + (state.profile.monthlyIncomeOther || 0);
  const monthSpent = computeEnvelopeSpent(state.transactions, targetMonth);
  const env = state.envelopes.map((e) => ({ ...e, spent: monthSpent[e.id] || 0 }));
  const totalBudget = env.reduce((a, e) => a + e.budget, 0);
  const totalSpent = env.reduce((a, e) => a + e.spent, 0);
  const monthInflows = computeMonthInflows(state.transactions, targetMonth);
  const needs = env.filter((e) => e.type === "need");
  const wants = env.filter((e) => e.type === "want");
  const saves = env.filter((e) => e.type === "save");
  const needSpent = needs.reduce((a, e) => a + e.spent, 0);
  const wantSpent = wants.reduce((a, e) => a + e.spent, 0);
  const saveBudget = saves.reduce((a, e) => a + e.budget, 0);
  const emergency = state.goals.find((g) => g.icon === "shield");
  const insights = [];

  // 1. Overspent envelopes
  env.forEach((e) => {
    if (e.budget > 0 && e.spent > e.budget) {
      insights.push({
        sev: "alert",
        title: `${e.name} is over budget`,
        body: `You've spent $${Math.round(e.spent)} against a $${Math.round(e.budget)} envelope — that's $${Math.round(e.spent - e.budget)} over. Either trim spending here for the rest of the month, or move budget from an under-used envelope.`,
      });
    } else if (e.budget > 0 && e.spent > e.budget * 0.85) {
      insights.push({
        sev: "warn",
        title: `${e.name} is nearly used up`,
        body: `${Math.round((e.spent / e.budget) * 100)}% of this envelope is gone. Slow down here to avoid dipping into savings.`,
      });
    }
  });

  // 2. Income vs budget
  if (income > 0 && totalBudget > income) {
    insights.push({
      sev: "alert",
      title: "Your budget exceeds your take-home pay",
      body: `Your envelopes total $${Math.round(totalBudget)} but you take home $${Math.round(income)}. A budget should always be less than or equal to income — reduce a 'want' envelope to balance it.`,
    });
  }

  // 3. Wants ratio
  if (income > 0 && wantSpent > income * 0.35) {
    insights.push({
      sev: "warn",
      title: "Discretionary spending is running high",
      body: `Dining, shopping and fun add up to $${Math.round(wantSpent)} — over 35% of your take-home pay. A common guideline keeps 'wants' near 30%. Trimming this is the fastest way to free up money for goals.`,
    });
  }

  // 4. Emergency fund priority
  if (emergency && emergency.target > 0) {
    const pct = emergency.saved / emergency.target;
    if (pct < 1) {
      insights.push({
        sev: pct < 0.3 ? "warn" : "info",
        title: `Emergency fund is ${Math.round(pct * 100)}% funded`,
        body: pct < 0.3
          ? `This is your safety net before any investing. Aim to fill it to $${Math.round(emergency.target)} first — it covers job loss or surprise bills without debt.`
          : `Good progress. Once this hits 100%, you can confidently start investing the surplus.`,
      });
    } else {
      insights.push({
        sev: "good",
        title: "Emergency fund is fully built",
        body: `You have a complete safety net. You're now in a strong position to start investing regularly — consider a low-cost diversified fund.`,
      });
    }
  }

  // 5. Savings rate
  if (income > 0) {
    const rate = saveBudget / income;
    if (rate < 0.1) {
      insights.push({
        sev: "warn",
        title: "Savings rate is below 10%",
        body: `You're budgeting $${Math.round(saveBudget)} to savings — about ${Math.round(rate * 100)}% of income. As a fresh grad with low fixed costs, aiming for 20%+ now builds a huge head start.`,
      });
    } else if (rate >= 0.2) {
      insights.push({
        sev: "good",
        title: `Strong savings rate — ${Math.round(rate * 100)}%`,
        body: `You're saving a healthy share of your income. Future-you will thank you. Make sure this money is actually working (high-yield account or invested), not idle.`,
      });
    }
  }

  // 6. Subscriptions creep
  const subs = env.find((e) => e.name.toLowerCase().includes("subscription") || e.name.toLowerCase().includes("bills"));
  if (subs && subs.spent > income * 0.12 && income > 0) {
    insights.push({
      sev: "info",
      title: "Worth auditing your subscriptions",
      body: `Bills & subscriptions are $${Math.round(subs.spent)}. Recurring charges are easy to forget — cancel anything you haven't used in 30 days.`,
    });
  }

  return { cpf, income, totalBudget, totalSpent, needSpent, wantSpent, saveBudget, insights, monthInflows, envelopes: env };
}

const monthName = () => new Date().toLocaleString("en-SG", { month: "long", year: "numeric" });

// Derive envelope "spent" from transactions for a given month (YYYY-MM).
// This is the single source of truth — replaces stale accumulator logic.
function computeEnvelopeSpent(transactions, monthStr) {
  const spent = {};
  (transactions || []).forEach((t) => {
    if ((t.type || "expense") !== "expense") return;
    if (!(t.date || "").startsWith(monthStr)) return;
    spent[t.envId] = (spent[t.envId] || 0) + t.amount;
  });
  return spent;
}

function currentMonthStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
}

// Compute total inflows for a given month.
function computeMonthInflows(transactions, monthStr) {
  return (transactions || []).filter((t) =>
    t.type === "inflow" && (t.date || "").startsWith(monthStr)
  ).reduce((a, t) => a + t.amount, 0);
}

// List of unique months that have transactions, newest first.
function transactionMonths(transactions) {
  const months = new Set();
  (transactions || []).forEach((t) => {
    if (t.date) months.add(t.date.slice(0, 7));
  });
  return Array.from(months).sort().reverse();
}

// For the dashboard month selector: all months with data + current month, newest first.
function dashboardMonths(transactions) {
  const months = new Set();
  months.add(currentMonthStr());
  (transactions || []).forEach((t) => {
    if (t.date) months.add(t.date.slice(0, 7));
  });
  return Array.from(months).sort().reverse();
}

// Format "2026-05" to "May 26"
function fmtMonthShort(monthStr) {
  const [y, m] = monthStr.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString("en-SG", { month: "short" }) + " " + y.slice(2);
}

// Format "2026-05" to "May 2026"
function fmtMonthLong(monthStr) {
  const [y, m] = monthStr.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString("en-SG", { month: "long", year: "numeric" });
}

/* ============================================================
   DASHBOARD — MACRO VIEW
   ============================================================ */
function Dashboard({ state, update, goTo }) {
  const [selectedMonth, setSelectedMonth] = useState(currentMonthStr());
  const months = useMemo(() => dashboardMonths(state.transactions), [state.transactions]);
  const isCurrentMonth = selectedMonth === currentMonthStr();

  const m = useMemo(() => buildInsights(state, selectedMonth), [state, selectedMonth]);
  const remaining = m.income - m.totalSpent + m.monthInflows;
  const spentPct = m.income > 0 ? Math.min(100, (m.totalSpent / m.income) * 100) : 0;

  const topFlags = m.insights.filter((i) => i.sev === "alert" || i.sev === "warn").slice(0, 4);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, color: C.ink, display: "flex", alignItems: "center", gap: 8 }}>
            <LayoutDashboard size={19} color={C.lavDeep} /> {fmtMonthLong(selectedMonth)} overview
          </h2>
          <p style={{ margin: "2px 0 0 27px", fontSize: 12.5, color: C.inkSoft }}>
            {isCurrentMonth ? "Your money at a glance" : "Historical snapshot"}
          </p>
        </div>
        <select
          style={{
            ...sx.miniSelect, fontWeight: 700, fontSize: 12.5, padding: "8px 12px",
            borderRadius: 10, minWidth: 90, color: C.lavDeep, background: C.lavBg,
            border: `1px solid ${C.lav}`,
          }}
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
        >
          {months.map((mo) => (
            <option key={mo} value={mo}>
              {fmtMonthShort(mo)}{mo === currentMonthStr() ? " ●" : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Hero stats — inflow / outflow / net for the selected month */}
      <div style={sx.statRow}>
        <StatCard
          label={`Inflow ${isCurrentMonth ? "this month" : fmtMonthShort(selectedMonth)}`}
          value={m.monthInflows} accent={C.mintDeep} bg={C.mintBg} icon={TrendingUp} />
        <StatCard
          label={`Outflow ${isCurrentMonth ? "this month" : fmtMonthShort(selectedMonth)}`}
          value={m.totalSpent} accent={C.peachDeep} bg={C.peachBg} icon={Wallet} />
        <StatCard
          label="Net"
          value={m.monthInflows - m.totalSpent}
          accent={m.monthInflows - m.totalSpent >= 0 ? C.skyDeep : C.roseDeep}
          bg={m.monthInflows - m.totalSpent >= 0 ? C.skyBg : C.roseBg} icon={PiggyBank} />
      </div>

      {/* Monthly spend pace */}
      <div style={sx.card}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>Monthly spend pace</span>
          <span style={{ fontSize: 13, color: C.inkSoft }}>{Math.round(spentPct)}% of income used</span>
        </div>
        <div style={sx.track}>
          <div style={{
            ...sx.fill, width: `${spentPct}%`,
            background: spentPct > 90 ? C.roseDeep : spentPct > 70 ? C.butterDeep : C.mintDeep,
          }} />
        </div>
        <p style={{ fontSize: 11.5, color: C.inkFaint, margin: "8px 0 0" }}>
          {spentPct > 90
            ? "You're close to spending your whole paycheck — ease off non-essentials."
            : spentPct > 70
            ? "On the higher side. Keep an eye on discretionary spending."
            : "Comfortable pace — there's room to send more toward goals."}
        </p>
      </div>

      {/* Spending outlook — donut + envelope health (with daily/weekly/monthly toggle) */}
      <SpendingOutlook state={state} selectedMonth={selectedMonth} />

      {/* What needs your attention */}
      <div style={sx.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h4 style={{ ...sx.cardH4, margin: 0 }}>
            <Sparkles size={14} color={C.lavDeep} style={{ verticalAlign: -2, marginRight: 5 }} />
            What needs your attention
          </h4>
          <button style={sx.linkBtn} onClick={() => goTo("coach")}>
            Ask the coach <ChevronRight size={13} />
          </button>
        </div>
        {topFlags.length > 0 ? topFlags.map((f, i) => <InsightRow key={i} insight={f} />)
          : <p style={{ fontSize: 12.5, color: C.mintDeep, margin: "10px 0 4px" }}>
              <CheckCircle2 size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
              Nothing urgent — your budget looks healthy this month.
            </p>}
      </div>

      {/* Upcoming: reminders + renewals */}
      <UpcomingCard state={state} goTo={goTo} />

      {/* Goal progress */}
      <div style={sx.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h4 style={{ ...sx.cardH4, margin: 0 }}>Goal progress</h4>
          <button style={sx.linkBtn} onClick={() => goTo("goals")}>All goals <ChevronRight size={13} /></button>
        </div>
        {state.goals.slice(0, 4).map((g) => {
          const pct = g.target > 0 ? Math.min(100, (g.saved / g.target) * 100) : 0;
          return (
            <div key={g.id} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>
                  {goalIcon(g.icon)} {g.name}
                </span>
                <span style={{ fontSize: 12, color: C.inkSoft }}>
                  ${Math.round(g.saved).toLocaleString()} / ${Math.round(g.target).toLocaleString()}
                </span>
              </div>
              <div style={sx.track}>
                <div style={{ ...sx.fill, width: `${pct}%`, background: C.lavDeep }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Financial snapshot — editable base assets + dynamic net worth */}
      <FinancialSnapshot state={state} update={update} />
    </div>
  );
}

/* ============================================================
   FINANCIAL SNAPSHOT — editable base assets + dynamic net worth
   ============================================================ */
function FinancialSnapshot({ state, update }) {
  const [editing, setEditing] = useState(false);

  // Pull base amounts from state.assets; default to 0 if not set.
  const getAmount = (key) => {
    const a = (state.assets || []).find((x) => x.type === key);
    return a ? a.amount : 0;
  };

  // All-time inflows/expenses adjust the savings account dynamically.
  const allExpenses = (state.transactions || []).filter((t) => (t.type || "expense") === "expense")
    .reduce((a, t) => a + t.amount, 0);
  const allInflows = (state.transactions || []).filter((t) => t.type === "inflow")
    .reduce((a, t) => a + t.amount, 0);

  const baseSavings = getAmount("savings");
  const dynamicSavings = baseSavings + allInflows - allExpenses;

  // Net worth = dynamic savings + other static asset categories.
  const otherAssets = getAmount("fd") + getAmount("investments") + getAmount("cpf") + getAmount("other");
  const estNetWorth = dynamicSavings + otherAssets;

  const setAmount = (key, val) => {
    const num = Number(val) || 0;
    update((s) => {
      const existing = (s.assets || []).filter((x) => x.type !== key);
      const t = ASSET_TYPES.find((a) => a.key === key) || ASSET_TYPES[5];
      const nextAssets = num > 0
        ? [...existing, { id: "a" + key, type: key, label: t.label, amount: num }]
        : existing;
      const liquid = nextAssets.filter((x) => assetType(x.type).liquid)
        .reduce((a, x) => a + x.amount, 0);
      return {
        ...s, assets: nextAssets,
        profile: { ...s.profile, currentSavings: liquid },
      };
    });
  };

  return (
    <div style={sx.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h4 style={{ ...sx.cardH4, margin: 0 }}>
          <Landmark size={14} color={C.lavDeep} style={{ verticalAlign: -2, marginRight: 5 }} />
          Financial snapshot
        </h4>
        <button style={sx.linkBtn} onClick={() => setEditing(!editing)}>
          {editing ? "Done" : "Edit assets"} <Pencil size={12} />
        </button>
      </div>

      <div style={sx.statRow}>
        <div style={{ ...sx.statCard, background: C.lavBg, flex: 1 }}>
          <div style={{ fontSize: 10.5, color: C.inkSoft, fontWeight: 600 }}>Est. net worth</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.lavDeep, marginTop: 4 }}>
            ${Math.round(estNetWorth).toLocaleString()}
          </div>
        </div>
        <div style={{ ...sx.statCard, background: C.mintBg, flex: 1 }}>
          <div style={{ fontSize: 10.5, color: C.inkSoft, fontWeight: 600 }}>Savings account</div>
          <div style={{ fontSize: 20, fontWeight: 800,
            color: dynamicSavings >= 0 ? C.mintDeep : C.roseDeep, marginTop: 4 }}>
            ${Math.round(dynamicSavings).toLocaleString()}
          </div>
        </div>
      </div>

      <p style={{ fontSize: 10.5, color: C.inkFaint, margin: "4px 0 12px", lineHeight: 1.5 }}>
        Savings = base savings + ${Math.round(allInflows).toLocaleString()} inflows − ${Math.round(allExpenses).toLocaleString()} expenses.
        Net worth = savings + other assets.
      </p>

      {editing && (
        <div>
          <div style={{ ...sx.eduStrip, marginBottom: 10 }}>
            <ShieldCheck size={14} color={C.skyDeep} />
            <span>Edit your base balances. The <strong>savings account</strong> auto-syncs with every
              ledger entry; the others are static figures you update when balances change.</span>
          </div>
          {ASSET_TYPES.map((t) => {
            const isSavings = t.key === "savings";
            const baseVal = getAmount(t.key);
            return (
              <div key={t.key} style={sx.assetCard}>
                <div style={{ ...sx.assetIcon, background: CATEGORY_PALETTE[t.pal].bg }}>{t.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{t.label}</div>
                  <div style={{ fontSize: 10, color: C.inkFaint }}>
                    {isSavings
                      ? `Base $${Math.round(baseVal).toLocaleString()} → now ~$${Math.round(dynamicSavings).toLocaleString()} after ledger`
                      : t.liquid ? "Liquid — backs your emergency fund" : "Longer-term — not for emergencies"}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 11.5, color: C.inkFaint }}>$</span>
                  <input
                    style={sx.miniInput}
                    type="number"
                    value={baseVal || ""}
                    placeholder="0"
                    onChange={(e) => setAmount(t.key, e.target.value)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   SPENDING OUTLOOK — daily/weekly/monthly with inflow/outflow, donut, envelope health
   ============================================================ */
function SpendingOutlook({ state, selectedMonth }) {
  const viewingMonth = selectedMonth || currentMonthStr();
  const isCurrentMonth = viewingMonth === currentMonthStr();
  const [period, setPeriod] = useState("monthly");

  // For past months, force monthly view (daily/weekly are meaningless).
  const effectivePeriod = isCurrentMonth ? period : "monthly";

  // Parse the target month into year/month.
  const [targetY, targetM] = viewingMonth.split("-").map(Number);

  // Compute date range [startISO, endISO] for the selected granularity.
  const now = new Date(); now.setHours(0, 0, 0, 0);
  let startDate, endDate;
  if (effectivePeriod === "daily" && isCurrentMonth) {
    startDate = new Date(now);
    endDate = new Date(now);
  } else if (effectivePeriod === "weekly" && isCurrentMonth) {
    startDate = new Date(now);
    const dayOfWeek = startDate.getDay(); // 0=Sun
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // shift so Mon=0
    startDate.setDate(startDate.getDate() - diff);
    endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6);
  } else {
    // Monthly — use the target month.
    startDate = new Date(targetY, targetM - 1, 1);
    endDate = new Date(targetY, targetM, 0); // last day of that month
  }
  const startISO = startDate.toISOString().slice(0, 10);
  const endISO = endDate.toISOString().slice(0, 10);

  // Filter transactions strictly within the date range.
  const txns = (state.transactions || []).filter((t) => {
    const d = t.date || "";
    return d >= startISO && d <= endISO;
  });
  const expenses = txns.filter((t) => (t.type || "expense") === "expense");
  const inflows = txns.filter((t) => t.type === "inflow");
  const totalOut = expenses.reduce((a, t) => a + t.amount, 0);
  const totalIn = inflows.reduce((a, t) => a + t.amount, 0);

  // How many days does this period span? Used for budget scaling.
  const daysInTargetMonth = new Date(targetY, targetM, 0).getDate();
  const periodDays = effectivePeriod === "daily" ? 1
    : effectivePeriod === "weekly" ? 7
    : daysInTargetMonth;
  const budgetScale = periodDays / 30; // monthly budgets are the baseline

  // Donut data from expenses in this period, grouped by envelope.
  const envGroups = {};
  expenses.forEach((t) => {
    const env = state.envelopes.find((e) => e.id === t.envId);
    const name = env ? env.name : "Other";
    const idx = env ? env.pal : 0;
    if (!envGroups[name]) envGroups[name] = { name, value: 0, fill: CATEGORY_PALETTE[idx].dot };
    envGroups[name].value += t.amount;
  });
  const pieData = Object.values(envGroups).filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);

  const monthLabel = isCurrentMonth ? "This month" : fmtMonthShort(viewingMonth);
  const periodLabel = effectivePeriod === "daily" ? "Today"
    : effectivePeriod === "weekly" ? `This week (${fmtDate(startISO)} – ${fmtDate(endISO)})`
    : monthLabel;
  const shortLabel = effectivePeriod === "daily" ? "today" : effectivePeriod === "weekly" ? "this week" : monthLabel.toLowerCase();

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.ink }}>Spending outlook</h4>
        <div style={{ display: "flex", gap: 4, background: C.bg, borderRadius: 9, padding: 3 }}>
          {["daily", "weekly", "monthly"].map((p) => {
            const disabled = !isCurrentMonth && p !== "monthly";
            return (
              <button key={p} onClick={() => !disabled && setPeriod(p)} style={{
                ...sx.modeBtn,
                background: effectivePeriod === p ? C.lavDeep : "transparent",
                color: effectivePeriod === p ? "#fff" : disabled ? C.inkFaint : C.inkSoft,
                textTransform: "capitalize",
                opacity: disabled ? 0.45 : 1,
                cursor: disabled ? "default" : "pointer",
              }}>{p}</button>
            );
          })}
        </div>
      </div>

      <p style={{ fontSize: 11.5, color: C.inkFaint, margin: "-4px 0 10px" }}>
        {periodLabel} · {expenses.length} expense{expenses.length !== 1 ? "s" : ""}, {inflows.length} inflow{inflows.length !== 1 ? "s" : ""}
      </p>

      <div style={sx.chartRow}>
        {/* Donut: where money went this period */}
        <div style={{ ...sx.card, flex: 1, minWidth: 240 }}>
          <h4 style={sx.cardH4}>Where money went — {shortLabel}</h4>
          {pieData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={42} outerRadius={68}
                    paddingAngle={2}>
                    {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Pie>
                  <Tooltip formatter={(v) => `$${Math.round(v)}`} contentStyle={sx.tooltip} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ marginTop: 6 }}>
                {pieData.map((d, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 11.5 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 5, color: C.inkSoft }}>
                      <span style={{ width: 7, height: 7, borderRadius: 3, background: d.fill, display: "inline-block" }} />
                      {d.name}
                    </span>
                    <span style={{ fontWeight: 700, color: C.ink }}>
                      ${Math.round(d.value).toLocaleString()}
                      <span style={{ fontWeight: 400, color: C.inkFaint, marginLeft: 4 }}>
                        ({totalOut > 0 ? Math.round((d.value / totalOut) * 100) : 0}%)
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : <EmptyMini text={`No expenses logged ${shortLabel}`} />}
        </div>

        {/* Envelope health for this period — matches Envelopes tab format */}
        <div style={{ ...sx.card, flex: 1.4, minWidth: 280 }}>
          <h4 style={sx.cardH4}>Envelope health — {shortLabel}</h4>
          {state.envelopes.filter((e) => e.budget > 0).length > 0 ? (
            <div>
              {state.envelopes.filter((e) => e.budget > 0).map((e) => {
                // Spent in this period (current month for monthly, today/this week otherwise).
                const periodSpent = expenses.filter((t) => t.envId === e.id)
                  .reduce((a, t) => a + t.amount, 0);
                // For monthly view, use the raw envelope budget so it matches the Envelopes tab exactly.
                // For daily/weekly, scale proportionally for a sensible comparison.
                const effectiveBudget = effectivePeriod === "monthly"
                  ? e.budget
                  : Math.round(e.budget * budgetScale);
                const pctE = effectiveBudget > 0 ? Math.min(100, (periodSpent / effectiveBudget) * 100) : 0;
                const over = periodSpent > effectiveBudget && effectiveBudget > 0;
                const pal = CATEGORY_PALETTE[e.pal];
                const left = effectiveBudget - periodSpent;
                return (
                  <div key={e.id} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: C.ink }}>
                        <span style={{ width: 8, height: 8, borderRadius: 4, background: pal.dot, display: "inline-block" }} />
                        {e.name}
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 800,
                        color: over ? C.roseDeep : pctE > 85 ? C.butterDeep : C.mintDeep }}>
                        {over ? `$${Math.round(periodSpent - effectiveBudget)} over budget` :
                          `$${Math.round(left)} left`}
                      </span>
                    </div>
                    <div style={{ ...sx.track, height: 7, marginTop: 5 }}>
                      <div style={{ ...sx.fill, width: `${pctE}%`,
                        background: over ? C.roseDeep : pctE > 85 ? C.butterDeep : pal.deep }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
                      <span style={{ fontSize: 10, color: over ? C.roseDeep : C.inkFaint }}>
                        ${Math.round(periodSpent)} spent
                      </span>
                      <span style={{ fontSize: 10, color: C.inkFaint }}>
                        ${Math.round(effectiveBudget)} budget
                      </span>
                    </div>
                  </div>
                );
              })}
              {effectivePeriod !== "monthly" && (
                <p style={{ fontSize: 10, color: C.inkFaint, margin: "6px 0 0" }}>
                  Budget scaled to {periodDays} day{periodDays !== 1 ? "s" : ""} from your monthly amounts.
                  Switch to <strong>monthly</strong> to match the Envelopes tab exactly.
                </p>
              )}
            </div>
          ) : <EmptyMini text="Set envelope budgets to track health" />}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   UPCOMING — reminders & subscription renewals due soon
   ============================================================ */
function UpcomingCard({ state, goTo }) {
  const reminders = (state.reminders || [])
    .filter((r) => !r.settled)
    .map((r) => {
      const due = r.frequency && r.frequency !== "once"
        ? nextOccurrence(r.dueDate, r.frequency, r.endDate) : r.dueDate;
      return { kind: "owed", label: r.who, sub: r.purpose, amount: r.amount,
        days: daysUntil(due), date: due, tab: "owed" };
    });
  const renewals = (state.subscriptions || [])
    .filter((s) => s.active !== false)
    .map((s) => ({ kind: "sub", label: s.name, sub: "Renews / deducts", amount: s.cost,
      days: daysUntil(s.nextRenew), date: s.nextRenew, tab: "subs" }));

  // Show items within the next 7 days, or anything overdue.
  const items = [...reminders, ...renewals]
    .filter((i) => i.days !== null && i.days <= 7)
    .sort((a, b) => a.days - b.days)
    .slice(0, 5);

  if (items.length === 0) return null;

  return (
    <div style={sx.card}>
      <h4 style={{ ...sx.cardH4 }}>
        <BellRing size={14} color={C.lavDeep} style={{ verticalAlign: -2, marginRight: 5 }} />
        Coming up this week
      </h4>
      {items.map((i, idx) => {
        const overdue = i.days < 0;
        const isOwed = i.kind === "owed";
        return (
          <div key={idx} onClick={() => goTo(i.tab)} style={{
            display: "flex", alignItems: "center", gap: 10, padding: "9px 0",
            borderBottom: idx < items.length - 1 ? `1px solid ${C.line}` : "none", cursor: "pointer",
          }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0,
              background: isOwed ? C.mintBg : C.peachBg, display: "flex",
              alignItems: "center", justifyContent: "center" }}>
              {isOwed ? <HandCoins size={14} color={C.mintDeep} />
                : <RefreshCw size={14} color={C.peachDeep} />}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{i.label}</div>
              <div style={{ fontSize: 10.5, color: C.inkFaint }}>
                {i.sub} · {fmtDate(i.date)}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12.5, fontWeight: 800,
                color: isOwed ? C.mintDeep : C.peachDeep }}>
                {isOwed ? "+" : "-"}${i.amount.toLocaleString()}
              </div>
              <div style={{ fontSize: 9.5, fontWeight: 800,
                color: overdue ? C.roseDeep : i.days <= 2 ? C.butterDeep : C.inkFaint }}>
                {dueLabel(i.days)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   NET WORTH — editable assets, stored locally only
   ============================================================ */
function NetWorthCard({ state, update }) {
  const [editing, setEditing] = useState(false);
  const assets = state.assets || [];
  const total = assets.reduce((a, x) => a + x.amount, 0);
  const liquid = assets.filter((x) => assetType(x.type).liquid).reduce((a, x) => a + x.amount, 0);

  const pieData = assets
    .filter((x) => x.amount > 0)
    .map((x) => ({
      name: x.label,
      value: x.amount,
      fill: CATEGORY_PALETTE[assetType(x.type).pal].dot,
    }));

  return (
    <div style={sx.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <h4 style={{ ...sx.cardH4, margin: 0 }}>
          <Landmark size={14} color={C.lavDeep} style={{ verticalAlign: -2, marginRight: 5 }} />
          Net worth
        </h4>
        <button style={sx.linkBtn} onClick={() => setEditing(!editing)}>
          {editing ? "Done" : "Update"} <Pencil size={12} />
        </button>
      </div>

      {total === 0 && !editing && (
        <p style={{ fontSize: 12, color: C.inkFaint, margin: "6px 0" }}>
          No assets added yet. Tap "Update" to record what you have across savings, fixed deposits,
          investments, and CPF.
        </p>
      )}

      {total > 0 && !editing && (
        <>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <div style={{ width: 110, height: 110, flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={30} outerRadius={50}
                    paddingAngle={2}>
                    {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Pie>
                  <Tooltip formatter={(v) => `$${Math.round(v).toLocaleString()}`} contentStyle={sx.tooltip} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: C.inkFaint, fontWeight: 600 }}>Total net worth</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: C.lavDeep, letterSpacing: -0.5 }}>
                ${Math.round(total).toLocaleString()}
              </div>
              <div style={{ fontSize: 11, color: C.skyDeep, marginTop: 2 }}>
                ${Math.round(liquid).toLocaleString()} liquid · ${Math.round(total - liquid).toLocaleString()} longer-term
              </div>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            {assets.filter((x) => x.amount > 0).map((x) => {
              const t = assetType(x.type);
              return (
                <div key={x.id} style={{ display: "flex", justifyContent: "space-between",
                  padding: "5px 0", fontSize: 12 }}>
                  <span style={{ color: C.inkSoft }}>
                    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 3,
                      background: CATEGORY_PALETTE[t.pal].dot, marginRight: 7 }} />
                    {t.icon} {x.label}
                  </span>
                  <span style={{ fontWeight: 700, color: C.ink }}>
                    ${Math.round(x.amount).toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {editing && <AssetEditor state={state} update={update} />}
    </div>
  );
}

function AssetEditor({ state, update }) {
  const assets = state.assets || [];
  const amountFor = (key) => {
    const a = assets.find((x) => x.type === key);
    return a ? a.amount : "";
  };
  const setAmount = (key, val) => {
    const num = Number(val) || 0;
    update((s) => {
      const existing = (s.assets || []).filter((x) => x.type !== key);
      const t = assetType(key);
      const nextAssets = num > 0
        ? [...existing, { id: "a" + key, type: key, label: t.label, amount: num }]
        : existing;
      // keep liquid total synced into profile.currentSavings + emergency goal
      const liquid = nextAssets.filter((x) => assetType(x.type).liquid)
        .reduce((a, x) => a + x.amount, 0);
      return {
        ...s,
        assets: nextAssets,
        profile: { ...s.profile, currentSavings: liquid },
      };
    });
  };

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ ...sx.eduStrip, marginBottom: 12 }}>
        <ShieldCheck size={14} color={C.skyDeep} />
        <span>All amounts stay on this device only. Update these whenever your balances change —
          your net worth and emergency-fund progress update automatically.</span>
      </div>
      {ASSET_TYPES.map((t) => (
        <div key={t.key} style={sx.assetCard}>
          <div style={{ ...sx.assetIcon, background: CATEGORY_PALETTE[t.pal].bg }}>{t.icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{t.label}</div>
            <div style={{ fontSize: 10, color: C.inkFaint }}>
              {t.liquid ? "Liquid — backs your emergency fund" : "Longer-term — not for emergencies"}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 11.5, color: C.inkFaint }}>$</span>
            <input
              style={sx.miniInput}
              type="number"
              value={amountFor(t.key)}
              placeholder="0"
              onChange={(e) => setAmount(t.key, e.target.value)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, accent, bg, icon: Icon, isCount }) {
  return (
    <div style={{ ...sx.statCard, background: bg }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span style={{ fontSize: 11.5, color: C.inkSoft, fontWeight: 600 }}>{label}</span>
        <Icon size={15} color={accent} />
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent, marginTop: 6, letterSpacing: -0.5 }}>
        {isCount ? Math.round(value).toLocaleString() : `$${Math.round(value).toLocaleString()}`}
      </div>
    </div>
  );
}

function InsightRow({ insight }) {
  const cfg = {
    alert: { c: C.roseDeep, bg: C.roseBg, Icon: AlertTriangle },
    warn: { c: C.butterDeep, bg: C.butterBg, Icon: AlertTriangle },
    info: { c: C.skyDeep, bg: C.skyBg, Icon: Info },
    good: { c: C.mintDeep, bg: C.mintBg, Icon: CheckCircle2 },
  }[insight.sev];
  const { Icon } = cfg;
  return (
    <div style={{ display: "flex", gap: 10, padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
      <div style={{ width: 28, height: 28, borderRadius: 8, background: cfg.bg, display: "flex",
        alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon size={14} color={cfg.c} />
      </div>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{insight.title}</div>
        <div style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.55, marginTop: 2 }}>{insight.body}</div>
      </div>
    </div>
  );
}

function goalIcon(key) {
  const map = { shield: "🛡️", home: "🏠", plane: "✈️", hammer: "🔨", pig: "🐷", target: "🎯" };
  return map[key] || "🎯";
}

function EmptyMini({ text }) {
  return (
    <div style={{ height: 170, display: "flex", alignItems: "center", justifyContent: "center",
      color: C.inkFaint, fontSize: 12, textAlign: "center", padding: 20 }}>
      {text}
    </div>
  );
}

function SectionTitle({ icon: Icon, title, subtitle }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h2 style={{ margin: 0, fontSize: 18, color: C.ink, display: "flex", alignItems: "center", gap: 8 }}>
        <Icon size={19} color={C.lavDeep} /> {title}
      </h2>
      <p style={{ margin: "2px 0 0 27px", fontSize: 12.5, color: C.inkSoft }}>{subtitle}</p>
    </div>
  );
}

/* ============================================================
   ENVELOPES — GUIDED SPENDING
   ============================================================ */
function Envelopes({ state, update }) {
  const m = useMemo(() => buildInsights(state), [state]);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);

  // Use computed spent from transactions (current month only).
  const envsWithSpent = m.envelopes;

  const totalBudget = envsWithSpent.reduce((a, e) => a + e.budget, 0);
  const unallocated = m.income - totalBudget;

  const setBudget = (id, val) => {
    update((s) => ({
      ...s, envelopes: s.envelopes.map((e) => e.id === id ? { ...e, budget: Number(val) || 0 } : e),
    }));
  };
  const removeEnv = (id) => {
    update((s) => ({ ...s, envelopes: s.envelopes.filter((e) => e.id !== id) }));
  };
  const addEnv = (name, type) => {
    const pal = state.envelopes.length % CATEGORY_PALETTE.length;
    update((s) => ({
      ...s, envelopes: [...s.envelopes, {
        id: "e" + Date.now(), name, budget: 0, spent: 0, pal, type,
      }],
    }));
    setAdding(false);
  };

  const groups = [
    { type: "need", label: "Needs", desc: "Essentials you can't skip", color: C.skyDeep },
    { type: "want", label: "Wants", desc: "Lifestyle & enjoyment", color: C.peachDeep },
    { type: "save", label: "Save & invest", desc: "Future you", color: C.mintDeep },
  ];

  return (
    <div>
      <SectionTitle icon={Wallet} title="Spending envelopes"
        subtitle="Give every dollar a job before the month starts" />

      {/* Allocation banner */}
      <div style={{ ...sx.card, background: unallocated < 0 ? C.roseBg : C.mintBg, border: "none" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 12, color: C.inkSoft, fontWeight: 600 }}>
              {unallocated < 0 ? "Over-allocated" : "Left to allocate"}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2,
              color: unallocated < 0 ? C.roseDeep : C.mintDeep }}>
              ${Math.abs(Math.round(unallocated)).toLocaleString()}
            </div>
          </div>
          <div style={{ textAlign: "right", fontSize: 11.5, color: C.inkSoft, maxWidth: 180 }}>
            {unallocated < 0
              ? "You've budgeted more than you earn. Trim an envelope."
              : unallocated > 0
              ? "Assign this to savings or a goal so no dollar sits idle."
              : "Every dollar is assigned. This is a balanced budget."}
          </div>
        </div>
      </div>

      <div style={sx.eduStrip}>
        <BookOpen size={14} color={C.lavDeep} />
        <span><strong>The 50/30/20 idea:</strong> roughly 50% of take-home to needs, 30% to wants,
          20% to saving. It's a starting frame, not a rule — adjust to your life.</span>
      </div>

      {groups.map((g) => {
        const items = envsWithSpent.filter((e) => e.type === g.type);
        const gBudget = items.reduce((a, e) => a + e.budget, 0);
        const gSpent = items.reduce((a, e) => a + e.spent, 0);
        const gPct = m.income > 0 ? Math.round((gBudget / m.income) * 100) : 0;
        return (
          <div key={g.type} style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: g.color }}>{g.label}</span>
              <span style={{ fontSize: 11.5, color: C.inkFaint }}>{g.desc}</span>
              <span style={{ marginLeft: "auto", fontSize: 11.5, color: C.inkSoft }}>
                {gPct}% of income · ${Math.round(gSpent)}/${Math.round(gBudget)}
              </span>
            </div>
            {items.map((e) => {
              const pal = CATEGORY_PALETTE[e.pal];
              const pct = e.budget > 0 ? Math.min(100, (e.spent / e.budget) * 100) : 0;
              const over = e.spent > e.budget && e.budget > 0;
              return (
                <div key={e.id} style={{ ...sx.envCard, borderLeft: `4px solid ${pal.dot}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{e.name}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11.5, color: C.inkFaint }}>$</span>
                      <input
                        style={sx.miniInput}
                        type="number"
                        value={e.budget || ""}
                        placeholder="0"
                        onChange={(ev) => setBudget(e.id, ev.target.value)}
                      />
                      <button style={sx.miniIconBtn} onClick={() => removeEnv(e.id)} aria-label="Delete">
                        <Trash2 size={13} color={C.inkFaint} />
                      </button>
                    </div>
                  </div>
                  <div style={{ ...sx.track, marginTop: 8, height: 7 }}>
                    <div style={{ ...sx.fill, width: `${pct}%`,
                      background: over ? C.roseDeep : pct > 85 ? C.butterDeep : pal.deep }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
                    <span style={{ fontSize: 11, color: over ? C.roseDeep : C.inkSoft }}>
                      ${Math.round(e.spent)} spent{over ? ` · $${Math.round(e.spent - e.budget)} over` : ""}
                    </span>
                    <span style={{ fontSize: 11, color: C.inkFaint }}>
                      ${Math.max(0, Math.round(e.budget - e.spent))} left
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {adding ? (
        <AddEnvelopeForm onAdd={addEnv} onCancel={() => setAdding(false)} />
      ) : (
        <button style={sx.dashedBtn} onClick={() => setAdding(true)}>
          <Plus size={15} /> Add a new envelope
        </button>
      )}
    </div>
  );
}

function AddEnvelopeForm({ onAdd, onCancel }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("want");
  return (
    <div style={sx.card}>
      <h4 style={sx.cardH4}>New envelope</h4>
      <input style={sx.input} placeholder="Envelope name (e.g. Gym, Gifts)" value={name}
        onChange={(e) => setName(e.target.value)} />
      <div style={{ display: "flex", gap: 6, margin: "10px 0" }}>
        {[["need", "Need"], ["want", "Want"], ["save", "Save"]].map(([v, l]) => (
          <button key={v} onClick={() => setType(v)} style={{
            ...sx.chip,
            background: type === v ? C.lavDeep : C.lavBg,
            color: type === v ? "#fff" : C.lavDeep,
          }}>{l}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={sx.ghostBtn} onClick={onCancel}>Cancel</button>
        <button style={{ ...sx.primaryBtn, opacity: name ? 1 : 0.5 }} disabled={!name}
          onClick={() => onAdd(name, type)}>Add envelope</button>
      </div>
    </div>
  );
}

/* ============================================================
   LEDGER — GRANULAR TRACKING (list/spreadsheet view)
   Now supports: search, column sorting, inline editing, inflows
   ============================================================ */
function Ledger({ state, update }) {
  const [form, setForm] = useState({
    desc: "", amount: "", envId: state.envelopes[0]?.id || "",
    date: todayISO(), type: "expense",
  });
  const [filter, setFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  const addTxn = () => {
    if (!form.desc || !form.amount) return;
    const amt = Number(form.amount);
    if (amt <= 0) return;
    const isInflow = form.type === "inflow";
    const txn = {
      id: "t" + Date.now(), desc: form.desc, amount: amt,
      envId: isInflow ? "__inflow" : form.envId, date: form.date,
      type: isInflow ? "inflow" : "expense",
    };
    update((s) => ({
      ...s,
      transactions: [txn, ...s.transactions],
      envelopes: isInflow ? s.envelopes : s.envelopes.map((e) =>
        e.id === form.envId ? { ...e, spent: e.spent + amt } : e),
    }));
    setForm({ ...form, desc: "", amount: "" });
  };

  const delTxn = (t) => {
    update((s) => ({
      ...s,
      transactions: s.transactions.filter((x) => x.id !== t.id),
      envelopes: t.type === "inflow" ? s.envelopes
        : s.envelopes.map((e) => e.id === t.envId
          ? { ...e, spent: Math.max(0, e.spent - t.amount) } : e),
    }));
  };

  // Inline editing
  const startEdit = (t) => {
    setEditingId(t.id);
    setEditForm({ desc: t.desc, amount: t.amount, envId: t.envId, date: t.date, type: t.type || "expense" });
  };
  const cancelEdit = () => { setEditingId(null); setEditForm({}); };
  const saveEdit = (t) => {
    const newAmt = Number(editForm.amount) || 0;
    if (!editForm.desc || newAmt <= 0) return;
    const oldIsExpense = (t.type || "expense") === "expense";
    const newIsExpense = (editForm.type || "expense") === "expense";
    update((s) => {
      // First undo old envelope effect
      let envs = oldIsExpense
        ? s.envelopes.map((e) => e.id === t.envId ? { ...e, spent: Math.max(0, e.spent - t.amount) } : e)
        : [...s.envelopes];
      // Then apply new envelope effect
      if (newIsExpense) {
        const newEnvId = editForm.envId === "__inflow" ? (s.envelopes[0]?.id || "") : editForm.envId;
        envs = envs.map((e) => e.id === newEnvId ? { ...e, spent: e.spent + newAmt } : e);
      }
      return {
        ...s,
        transactions: s.transactions.map((x) => x.id === t.id
          ? { ...x, desc: editForm.desc, amount: newAmt,
              envId: newIsExpense ? (editForm.envId === "__inflow" ? (s.envelopes[0]?.id || "") : editForm.envId) : "__inflow",
              date: editForm.date, type: editForm.type || "expense" }
          : x),
        envelopes: envs,
      };
    });
    setEditingId(null);
    setEditForm({});
  };

  const envName = (id) => {
    if (id === "__inflow") return "Inflow";
    return state.envelopes.find((e) => e.id === id)?.name || "—";
  };
  const envPal = (id) => {
    if (id === "__inflow") return { dot: C.mintDeep, deep: C.mintDeep, bg: C.mintBg };
    const e = state.envelopes.find((x) => x.id === id);
    return e ? CATEGORY_PALETTE[e.pal] : CATEGORY_PALETTE[0];
  };

  // Filter and search
  let list = state.transactions || [];
  if (filter === "inflow") list = list.filter((t) => t.type === "inflow");
  else if (filter === "expense") list = list.filter((t) => (t.type || "expense") === "expense");
  else if (filter !== "all") list = list.filter((t) => t.envId === filter);
  if (monthFilter !== "all") list = list.filter((t) => (t.date || "").startsWith(monthFilter));
  if (search.trim()) {
    const q = search.toLowerCase();
    list = list.filter((t) => t.desc.toLowerCase().includes(q));
  }

  // Sort
  const sorted = [...list].sort((a, b) => {
    let cmp = 0;
    if (sortCol === "date") cmp = (a.date || "").localeCompare(b.date || "");
    else if (sortCol === "desc") cmp = a.desc.localeCompare(b.desc);
    else if (sortCol === "amount") cmp = a.amount - b.amount;
    else if (sortCol === "env") cmp = envName(a.envId).localeCompare(envName(b.envId));
    return sortDir === "asc" ? cmp : -cmp;
  });

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  };

  const totalExpense = sorted.filter((t) => (t.type || "expense") === "expense").reduce((a, t) => a + t.amount, 0);
  const totalInflow = sorted.filter((t) => t.type === "inflow").reduce((a, t) => a + t.amount, 0);

  const SortIcon = ({ col }) => {
    if (sortCol !== col) return <ArrowUpDown size={10} color={C.inkFaint} style={{ marginLeft: 3 }} />;
    return sortDir === "asc"
      ? <ChevronUp size={10} color={C.lavDeep} style={{ marginLeft: 3 }} />
      : <ChevronDown size={10} color={C.lavDeep} style={{ marginLeft: 3 }} />;
  };

  return (
    <div>
      <SectionTitle icon={ListChecks} title="Expense ledger"
        subtitle="Log every transaction — expenses and inflows alike" />

      {/* Quick add */}
      <div style={sx.card}>
        <div style={{ display: "flex", gap: 5, marginBottom: 10 }}>
          {[["expense", "Expense", C.peachDeep, C.peachBg], ["inflow", "Inflow", C.mintDeep, C.mintBg]].map(([k, l, c, bg]) => (
            <button key={k} onClick={() => setForm({ ...form, type: k })} style={{
              ...sx.chip, flex: 1,
              background: form.type === k ? c : bg,
              color: form.type === k ? "#fff" : c,
            }}>{l}</button>
          ))}
        </div>
        <div style={sx.ledgerForm}>
          <input style={{ ...sx.input, flex: 2, minWidth: 130 }}
            placeholder={form.type === "inflow" ? "Source (e.g. Parents, freelance)" : "What did you buy?"}
            value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} />
          <input style={{ ...sx.input, flex: 1, minWidth: 90 }} type="number" placeholder="$ amount"
            value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </div>
        <div style={{ ...sx.ledgerForm, marginTop: 8 }}>
          {form.type === "expense" ? (
            <select style={{ ...sx.input, flex: 2, minWidth: 130 }} value={form.envId}
              onChange={(e) => setForm({ ...form, envId: e.target.value })}>
              {state.envelopes.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          ) : (
            <div style={{ ...sx.input, flex: 2, minWidth: 130, background: C.mintBg, color: C.mintDeep,
              fontWeight: 700, display: "flex", alignItems: "center", gap: 5, border: `1px solid ${C.mint}` }}>
              <TrendingUp size={13} /> Inflow — adds to available money
            </div>
          )}
          <input style={{ ...sx.input, flex: 1, minWidth: 90 }} type="date" value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </div>
        <button style={{ ...sx.primaryBtn, marginTop: 10, width: "100%",
          background: form.type === "inflow" ? C.mintDeep : C.lavDeep,
          opacity: form.desc && form.amount ? 1 : 0.5 }}
          disabled={!form.desc || !form.amount} onClick={addTxn}>
          <Plus size={15} /> {form.type === "inflow" ? "Record inflow" : "Add to ledger"}
        </button>
      </div>

      {/* Search + filter + totals */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "4px 2px 6px", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 130 }}>
          <Search size={13} color={C.inkFaint} style={{ position: "absolute", left: 10, top: 10 }} />
          <input style={{ ...sx.input, paddingLeft: 30, marginBottom: 0 }}
            placeholder="Search transactions…" value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select style={sx.miniSelect} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All</option>
          <option value="expense">Expenses only</option>
          <option value="inflow">Inflows only</option>
          {state.envelopes.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select style={sx.miniSelect} value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
          <option value="all">All months</option>
          {transactionMonths(state.transactions).map((m) => (
            <option key={m} value={m}>{new Date(m + "-01").toLocaleString("en-SG", { month: "short", year: "numeric" })}</option>
          ))}
        </select>
      </div>
      <div style={{ display: "flex", gap: 14, margin: "0 2px 12px", fontSize: 12, color: C.inkSoft }}>
        <span>{sorted.length} item{sorted.length !== 1 ? "s" : ""}</span>
        <span>Out: <strong style={{ color: C.peachDeep }}>${Math.round(totalExpense).toLocaleString()}</strong></span>
        <span>In: <strong style={{ color: C.mintDeep }}>${Math.round(totalInflow).toLocaleString()}</strong></span>
        <span>Net: <strong style={{ color: totalInflow - totalExpense >= 0 ? C.mintDeep : C.roseDeep }}>
          ${Math.round(totalInflow - totalExpense).toLocaleString()}</strong></span>
      </div>

      {/* Spreadsheet list */}
      <div style={sx.card}>
        {sorted.length === 0 ? (
          <div style={{ textAlign: "center", padding: "30px 10px", color: C.inkFaint }}>
            <Coffee size={26} color={C.inkFaint} />
            <p style={{ fontSize: 12.5, marginTop: 8 }}>
              {search ? "No transactions match your search." : "No transactions yet. Even that morning kopi counts!"}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={sx.table}>
              <thead>
                <tr>
                  <th style={{ ...sx.th, cursor: "pointer" }} onClick={() => toggleSort("date")}>
                    Date <SortIcon col="date" />
                  </th>
                  <th style={{ ...sx.th, cursor: "pointer" }} onClick={() => toggleSort("desc")}>
                    Description <SortIcon col="desc" />
                  </th>
                  <th style={{ ...sx.th, cursor: "pointer" }} onClick={() => toggleSort("env")}>
                    Envelope <SortIcon col="env" />
                  </th>
                  <th style={{ ...sx.th, textAlign: "right", cursor: "pointer" }} onClick={() => toggleSort("amount")}>
                    Amount <SortIcon col="amount" />
                  </th>
                  <th style={sx.th}></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((t) => {
                  const pal = envPal(t.envId);
                  const isInflow = t.type === "inflow";
                  const isEditing = editingId === t.id;

                  if (isEditing) {
                    return (
                      <tr key={t.id} style={{ background: C.lavBg }}>
                        <td style={sx.td}>
                          <input style={{ ...sx.miniInput, width: 100, textAlign: "left" }} type="date"
                            value={editForm.date} onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} />
                        </td>
                        <td style={sx.td}>
                          <input style={{ ...sx.miniInput, width: "100%", textAlign: "left" }}
                            value={editForm.desc} onChange={(e) => setEditForm({ ...editForm, desc: e.target.value })} />
                        </td>
                        <td style={sx.td}>
                          <select style={{ ...sx.miniInput, width: 100, textAlign: "left" }}
                            value={editForm.type === "inflow" ? "__inflow" : editForm.envId}
                            onChange={(e) => {
                              if (e.target.value === "__inflow") setEditForm({ ...editForm, type: "inflow", envId: "__inflow" });
                              else setEditForm({ ...editForm, type: "expense", envId: e.target.value });
                            }}>
                            <option value="__inflow">Inflow</option>
                            {state.envelopes.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                          </select>
                        </td>
                        <td style={{ ...sx.td, textAlign: "right" }}>
                          <input style={{ ...sx.miniInput, width: 70 }} type="number"
                            value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} />
                        </td>
                        <td style={{ ...sx.td, textAlign: "right" }}>
                          <div style={{ display: "flex", gap: 3 }}>
                            <button style={sx.miniIconBtn} onClick={() => saveEdit(t)} aria-label="Save">
                              <CheckCircle2 size={14} color={C.mintDeep} />
                            </button>
                            <button style={sx.miniIconBtn} onClick={cancelEdit} aria-label="Cancel">
                              <X size={14} color={C.inkFaint} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={t.id}>
                      <td style={sx.td}>{fmtDate(t.date)}</td>
                      <td style={{ ...sx.td, fontWeight: 600, color: C.ink }}>{t.desc}</td>
                      <td style={sx.td}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 3, background: pal.dot }} />
                          <span style={{ fontSize: 11.5 }}>{envName(t.envId)}</span>
                        </span>
                      </td>
                      <td style={{ ...sx.td, textAlign: "right", fontWeight: 700,
                        color: isInflow ? C.mintDeep : C.ink }}>
                        {isInflow ? "+" : "-"}${t.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ ...sx.td, textAlign: "right" }}>
                        <div style={{ display: "flex", gap: 2 }}>
                          <button style={sx.miniIconBtn} onClick={() => startEdit(t)} aria-label="Edit">
                            <Pencil size={12} color={C.inkFaint} />
                          </button>
                          <button style={sx.miniIconBtn} onClick={() => delTxn(t)} aria-label="Delete">
                            <Trash2 size={12} color={C.inkFaint} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function fmtDate(d) {
  try {
    return new Date(d).toLocaleDateString("en-SG", { day: "2-digit", month: "short" });
  } catch { return d; }
}

const todayISO = () => new Date().toISOString().slice(0, 10);

// Days from today until a date. Negative = overdue.
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
}

// Advance a date string by one recurrence cycle.
function advanceDate(dateStr, freq) {
  const d = new Date(dateStr);
  if (freq === "daily") d.setDate(d.getDate() + 1);
  else if (freq === "weekly") d.setDate(d.getDate() + 7);
  else if (freq === "monthly") d.setMonth(d.getMonth() + 1);
  else if (freq === "yearly") d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

// Roll a recurring date forward until it's today or later (or past its end date).
function nextOccurrence(dateStr, freq, endDate) {
  if (freq === "once" || !freq) return dateStr;
  let d = dateStr;
  let guard = 0;
  while (daysUntil(d) < 0 && guard < 800) {
    const advanced = advanceDate(d, freq);
    if (endDate && new Date(advanced) > new Date(endDate)) return d;
    d = advanced;
    guard++;
  }
  return d;
}

function dueLabel(days) {
  if (days === null) return "";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `In ${days} days`;
}

const FREQ_OPTIONS = [
  { key: "once", label: "One-time" },
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "yearly", label: "Yearly" },
];

/* ============================================================
   GOALS — MILESTONE TRACKING
   ============================================================ */
const GOAL_PRESETS = [
  { icon: "shield", name: "Emergency Fund", hint: "3-6 months of expenses" },
  { icon: "home", name: "BTO Down Payment", hint: "~10-25% of flat price" },
  { icon: "hammer", name: "Renovation Fund", hint: "$30k-60k typical for BTO" },
  { icon: "plane", name: "Travel Fund", hint: "Your next big trip" },
  { icon: "pig", name: "Investment Pot", hint: "Money to put to work" },
];

function Goals({ state, update }) {
  const [adding, setAdding] = useState(false);
  const [contributeTo, setContributeTo] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  // Always sort goals by deadline (earliest first). Goals without a deadline go to bottom.
  const sortedGoals = useMemo(() => {
    const indexed = state.goals.map((g, i) => ({ g, i }));
    indexed.sort((a, b) => {
      const aHas = !!a.g.deadline;
      const bHas = !!b.g.deadline;
      if (aHas && bHas) {
        if (a.g.deadline !== b.g.deadline) return a.g.deadline.localeCompare(b.g.deadline);
        return a.i - b.i;
      }
      if (aHas) return -1;
      if (bHas) return 1;
      return a.i - b.i;
    });
    return indexed.map((x) => x.g);
  }, [state.goals]);

  const addGoal = (g) => {
    update((s) => ({
      ...s, goals: [...s.goals, {
        id: "g" + Date.now(), name: g.name, icon: g.icon,
        target: g.target, saved: 0, deadline: g.deadline || "", note: g.note || "",
      }],
    }));
    setAdding(false);
  };
  const delGoal = (id) => update((s) => ({ ...s, goals: s.goals.filter((g) => g.id !== id) }));
  const contribute = (id, amt) => {
    update((s) => ({
      ...s, goals: s.goals.map((g) => g.id === id ? { ...g, saved: g.saved + amt } : g),
    }));
    setContributeTo(null);
  };

  // Inline editing
  const startEdit = (g) => {
    setEditingId(g.id);
    setEditForm({ name: g.name, target: g.target, saved: g.saved, note: g.note || "", deadline: g.deadline || "" });
  };
  const cancelEdit = () => { setEditingId(null); setEditForm({}); };
  const saveEdit = (id) => {
    const target = Number(editForm.target) || 0;
    const saved = Number(editForm.saved) || 0;
    if (!editForm.name || target < 0 || saved < 0) return;
    update((s) => ({
      ...s,
      goals: s.goals.map((g) => g.id === id
        ? { ...g, name: editForm.name, target, saved, note: editForm.note, deadline: editForm.deadline }
        : g),
    }));
    setEditingId(null);
    setEditForm({});
  };

  return (
    <div>
      <SectionTitle icon={Target} title="Goal trackers"
        subtitle="Sorted by target deadline — closest first" />

      <div style={sx.eduStrip}>
        <Lightbulb size={14} color={C.butterDeep} />
        <span><strong>Order matters:</strong> fully fund your emergency goal first, then split surplus
          between mid-term goals (travel, reno) and long-term investing. Don't invest money you'll need within ~3 years.</span>
      </div>

      {sortedGoals.map((g) => {
        const pct = g.target > 0 ? Math.min(100, (g.saved / g.target) * 100) : 0;
        const done = pct >= 100;
        const monthsLeft = g.deadline ? monthsBetween(new Date(), new Date(g.deadline)) : null;
        const perMonth = monthsLeft && monthsLeft > 0 ? (g.target - g.saved) / monthsLeft : null;
        const isEditing = editingId === g.id;

        if (isEditing) {
          return (
            <div key={g.id} style={{ ...sx.goalCard, background: C.lavBg, borderColor: C.lav }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={sx.goalIcon}>{goalIcon(g.icon)}</div>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: C.lavDeep }}>Editing goal</span>
                </div>
              </div>
              <Field label="Goal name">
                <input style={sx.input} value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </Field>
              <div style={{ display: "flex", gap: 8 }}>
                <Field label="Target amount (SGD)">
                  <input style={sx.input} type="number" value={editForm.target}
                    onChange={(e) => setEditForm({ ...editForm, target: e.target.value })} />
                </Field>
                <Field label="Amount saved (SGD)">
                  <input style={sx.input} type="number" value={editForm.saved}
                    onChange={(e) => setEditForm({ ...editForm, saved: e.target.value })} />
                </Field>
              </div>
              <Field label="Target date (optional)">
                <input style={sx.input} type="month" value={editForm.deadline}
                  onChange={(e) => setEditForm({ ...editForm, deadline: e.target.value })} />
              </Field>
              <Field label="Notes / remarks">
                <textarea
                  style={{ ...sx.input, minHeight: 70, resize: "vertical", fontFamily: "inherit",
                    lineHeight: 1.5, whiteSpace: "pre-wrap" }}
                  value={editForm.note}
                  onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
                  placeholder="Any context, links, or reminders for this goal…"
                />
              </Field>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={sx.ghostBtn} onClick={cancelEdit}>Cancel</button>
                <button style={sx.primaryBtn} onClick={() => saveEdit(g.id)}>
                  <CheckCircle2 size={14} /> Save changes
                </button>
              </div>
            </div>
          );
        }

        return (
          <div key={g.id} style={sx.goalCard}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ display: "flex", gap: 10, flex: 1, minWidth: 0 }}>
                <div style={sx.goalIcon}>{goalIcon(g.icon)}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{g.name}</div>
                  <div style={{ fontSize: 11.5, color: C.inkSoft }}>
                    ${Math.round(g.saved).toLocaleString()} of ${Math.round(g.target).toLocaleString()}
                    {done && <span style={{ color: C.mintDeep, fontWeight: 700 }}> · Reached! 🎉</span>}
                  </div>
                  {g.deadline && (
                    <div style={{ fontSize: 10.5, color: C.skyDeep, marginTop: 2, fontWeight: 600 }}>
                      <CalendarClock size={10} style={{ verticalAlign: -1, marginRight: 3 }} />
                      Target: {fmtMonthShort(g.deadline.slice(0, 7))}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 2 }}>
                <button style={sx.miniIconBtn} onClick={() => startEdit(g)} aria-label="Edit">
                  <Pencil size={13} color={C.inkFaint} />
                </button>
                <button style={sx.miniIconBtn} onClick={() => delGoal(g.id)} aria-label="Delete">
                  <Trash2 size={13} color={C.inkFaint} />
                </button>
              </div>
            </div>

            <div style={{ ...sx.track, marginTop: 10, height: 9 }}>
              <div style={{ ...sx.fill, width: `${pct}%`,
                background: done ? C.mintDeep : C.lavDeep }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
              <span style={{ fontSize: 11, color: C.inkFaint }}>{Math.round(pct)}% there</span>
              {perMonth !== null && perMonth > 0 && (
                <span style={{ fontSize: 11, color: C.skyDeep, fontWeight: 600 }}>
                  Save ${Math.round(perMonth)}/mo to hit your date
                </span>
              )}
            </div>

            {g.note && (
              <p style={{ fontSize: 11.5, color: C.inkSoft, margin: "8px 0 0", lineHeight: 1.5,
                background: C.bg, padding: "6px 9px", borderRadius: 7, whiteSpace: "pre-wrap" }}>
                {g.note}
              </p>
            )}

            {contributeTo === g.id ? (
              <ContributeForm onAdd={(amt) => contribute(g.id, amt)} onCancel={() => setContributeTo(null)} />
            ) : (
              <button style={{ ...sx.softBtn, marginTop: 10 }} onClick={() => setContributeTo(g.id)}>
                <Plus size={13} /> Add money to this goal
              </button>
            )}
          </div>
        );
      })}

      {adding ? (
        <AddGoalForm onAdd={addGoal} onCancel={() => setAdding(false)} />
      ) : (
        <button style={sx.dashedBtn} onClick={() => setAdding(true)}>
          <Plus size={15} /> Create a new goal
        </button>
      )}

      {/* Personal notes */}
      <GoalNotes state={state} update={update} />
    </div>
  );
}

function GoalNotes({ state, update }) {
  const notes = state.goalNotes || "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notes);

  // Sync draft when notes change externally (e.g. import).
  useEffect(() => { setDraft(state.goalNotes || ""); }, [state.goalNotes]);

  const save = () => {
    update((s) => ({ ...s, goalNotes: draft }));
    setEditing(false);
  };

  return (
    <div style={sx.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h4 style={{ ...sx.cardH4, margin: 0 }}>
          <BookOpen size={14} color={C.lavDeep} style={{ verticalAlign: -2, marginRight: 5 }} />
          Personal notes
        </h4>
        {!editing && (
          <button style={sx.linkBtn} onClick={() => { setDraft(notes); setEditing(true); }}>
            <Pencil size={12} style={{ marginRight: 3 }} /> {notes ? "Edit" : "Add notes"}
          </button>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            style={{
              ...sx.input, minHeight: 120, resize: "vertical", fontFamily: "inherit",
              lineHeight: 1.6, fontSize: 12.5, whiteSpace: "pre-wrap",
            }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write anything — financial goals, reminders to yourself, investment research notes, questions to look into…"
            autoFocus
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button style={sx.ghostBtn} onClick={() => setEditing(false)}>Cancel</button>
            <button style={sx.primaryBtn} onClick={save}>
              <CheckCircle2 size={14} /> Save notes
            </button>
          </div>
        </>
      ) : notes ? (
        <div style={{
          fontSize: 12.5, color: C.inkSoft, lineHeight: 1.65, whiteSpace: "pre-wrap",
          background: C.bg, padding: "10px 12px", borderRadius: 9,
        }}>
          {notes}
        </div>
      ) : (
        <p style={{ fontSize: 12, color: C.inkFaint, margin: "4px 0 0" }}>
          No notes yet. Use this space for anything — investment ideas, savings strategies,
          things you want to research, or just a pep talk to future-you.
        </p>
      )}
    </div>
  );
}

function ContributeForm({ onAdd, onCancel }) {
  const [amt, setAmt] = useState("");
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
      <input style={{ ...sx.input, flex: 1 }} type="number" placeholder="$ amount" value={amt}
        onChange={(e) => setAmt(e.target.value)} autoFocus />
      <button style={{ ...sx.primaryBtn, flex: "0 0 auto" }}
        onClick={() => { const n = Number(amt); if (n > 0) onAdd(n); }}>Add</button>
      <button style={{ ...sx.ghostBtn, flex: "0 0 auto" }} onClick={onCancel}>
        <X size={14} />
      </button>
    </div>
  );
}

function AddGoalForm({ onAdd, onCancel }) {
  const [preset, setPreset] = useState(GOAL_PRESETS[1]);
  const [name, setName] = useState(GOAL_PRESETS[1].name);
  const [target, setTarget] = useState("");
  const [deadline, setDeadline] = useState("");
  return (
    <div style={sx.card}>
      <h4 style={sx.cardH4}>New goal</h4>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {GOAL_PRESETS.map((p) => (
          <button key={p.icon} onClick={() => { setPreset(p); setName(p.name); }} style={{
            ...sx.chip, fontSize: 11,
            background: preset.icon === p.icon ? C.lavDeep : C.lavBg,
            color: preset.icon === p.icon ? "#fff" : C.lavDeep,
          }}>{goalIcon(p.icon)} {p.name}</button>
        ))}
      </div>
      <p style={{ fontSize: 11.5, color: C.inkFaint, margin: "0 0 10px" }}>{preset.hint}</p>
      <Field label="Goal name">
        <input style={sx.input} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Target amount (SGD)">
        <input style={sx.input} type="number" value={target} placeholder="e.g. 20000"
          onChange={(e) => setTarget(e.target.value)} />
      </Field>
      <Field label="Target date (optional)">
        <input style={sx.input} type="month" value={deadline}
          onChange={(e) => setDeadline(e.target.value)} />
      </Field>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={sx.ghostBtn} onClick={onCancel}>Cancel</button>
        <button style={{ ...sx.primaryBtn, opacity: name && target ? 1 : 0.5 }}
          disabled={!name || !target}
          onClick={() => onAdd({ icon: preset.icon, name, target: Number(target),
            deadline, note: preset.hint })}>
          Create goal
        </button>
      </div>
    </div>
  );
}

function monthsBetween(a, b) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

/* ============================================================
   OWED — MONEY OWED TO YOU, WITH REMINDERS
   ============================================================ */
function Owed({ state, update }) {
  const [adding, setAdding] = useState(false);
  const reminders = state.reminders || [];

  // Each reminder's effective due date accounts for recurrence.
  const enriched = reminders.map((r) => {
    const due = r.frequency && r.frequency !== "once"
      ? nextOccurrence(r.dueDate, r.frequency, r.endDate)
      : r.dueDate;
    return { ...r, effectiveDue: due, days: daysUntil(due) };
  }).sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999));

  const totalOwed = reminders.filter((r) => !r.settled).reduce((a, r) => a + r.amount, 0);
  const overdue = enriched.filter((r) => !r.settled && r.days !== null && r.days < 0);

  const addReminder = (r) => {
    update((s) => ({ ...s, reminders: [{ ...r, id: "r" + Date.now(), settled: false }, ...(s.reminders || [])] }));
    setAdding(false);
  };
  const settle = (id) => update((s) => ({
    ...s, reminders: s.reminders.map((r) => r.id === id ? { ...r, settled: !r.settled } : r),
  }));
  const del = (id) => update((s) => ({ ...s, reminders: s.reminders.filter((r) => r.id !== id) }));

  return (
    <div>
      <SectionTitle icon={HandCoins} title="Money owed to you"
        subtitle="Track IOUs and get reminders so you're never the one who forgets" />

      <div style={sx.statRow}>
        <StatCard label="Total owed to you" value={totalOwed} accent={C.mintDeep} bg={C.mintBg} icon={HandCoins} />
        <StatCard label="Overdue items" value={overdue.length} accent={C.roseDeep} bg={C.roseBg}
          icon={BellRing} isCount />
      </div>

      {overdue.length > 0 && (
        <div style={{ ...sx.eduStrip, background: C.roseBg }}>
          <BellRing size={14} color={C.roseDeep} />
          <span><strong>{overdue.length} reminder{overdue.length > 1 ? "s" : ""} overdue.</strong> A
            friendly nudge is usually all it takes — the longer you wait, the more awkward it feels.</span>
        </div>
      )}

      {reminders.length === 0 && !adding && (
        <div style={{ ...sx.card, textAlign: "center", padding: "28px 16px" }}>
          <HandCoins size={26} color={C.inkFaint} />
          <p style={{ fontSize: 12.5, color: C.inkSoft, margin: "8px 0 0" }}>
            Nothing tracked yet. Add a reminder whenever you lend money or front a shared bill.
          </p>
        </div>
      )}

      {enriched.map((r) => {
        const overdueR = !r.settled && r.days !== null && r.days < 0;
        const soon = !r.settled && r.days !== null && r.days >= 0 && r.days <= 3;
        return (
          <div key={r.id} style={{
            ...sx.card, marginBottom: 10, opacity: r.settled ? 0.6 : 1,
            borderLeft: `4px solid ${r.settled ? C.line : overdueR ? C.roseDeep : soon ? C.butterDeep : C.mintDeep}`,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.ink,
                  textDecoration: r.settled ? "line-through" : "none" }}>
                  {r.who}
                </div>
                <div style={{ fontSize: 11.5, color: C.inkSoft, marginTop: 1 }}>{r.purpose}</div>
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: r.settled ? C.inkFaint : C.mintDeep }}>
                ${r.amount.toLocaleString()}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              {r.dueDate && (
                <span style={{
                  fontSize: 10.5, fontWeight: 800, padding: "3px 8px", borderRadius: 6,
                  background: r.settled ? C.bg : overdueR ? C.roseBg : soon ? C.butterBg : C.skyBg,
                  color: r.settled ? C.inkFaint : overdueR ? C.roseDeep : soon ? C.butterDeep : C.skyDeep,
                }}>
                  <CalendarClock size={10} style={{ verticalAlign: -1, marginRight: 3 }} />
                  {r.settled ? "Settled" : `${dueLabel(r.days)} · ${fmtDate(r.effectiveDue)}`}
                </span>
              )}
              {r.frequency && r.frequency !== "once" && (
                <span style={sx.recurTag}>
                  <RefreshCw size={9} style={{ verticalAlign: -1, marginRight: 3 }} />
                  {r.frequency}{r.endDate ? ` until ${fmtDate(r.endDate)}` : ""}
                </span>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button style={{ ...sx.softBtn, flex: 1,
                background: r.settled ? C.bg : C.mintBg, color: r.settled ? C.inkSoft : C.mintDeep,
                borderColor: r.settled ? C.line : C.mint }}
                onClick={() => settle(r.id)}>
                <CheckCircle2 size={13} /> {r.settled ? "Mark unpaid" : "Mark as paid back"}
              </button>
              <button style={{ ...sx.ghostBtn, flex: "0 0 auto", padding: "8px 12px" }}
                onClick={() => del(r.id)}>
                <Trash2 size={13} color={C.inkFaint} />
              </button>
            </div>
          </div>
        );
      })}

      {adding ? (
        <ReminderForm onAdd={addReminder} onCancel={() => setAdding(false)} />
      ) : (
        <button style={sx.dashedBtn} onClick={() => setAdding(true)}>
          <Plus size={15} /> Add a reminder
        </button>
      )}
    </div>
  );
}

function ReminderForm({ onAdd, onCancel }) {
  const [who, setWho] = useState("");
  const [purpose, setPurpose] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(todayISO());
  const [frequency, setFrequency] = useState("once");
  const [endDate, setEndDate] = useState("");
  const valid = who && amount && Number(amount) > 0;

  return (
    <div style={sx.card}>
      <h4 style={sx.cardH4}>New reminder</h4>
      <Field label="Who owes you?">
        <input style={sx.input} value={who} onChange={(e) => setWho(e.target.value)}
          placeholder="e.g. Jaden, Mum, work claim" />
      </Field>
      <Field label="What is it for?">
        <input style={sx.input} value={purpose} onChange={(e) => setPurpose(e.target.value)}
          placeholder="e.g. Concert ticket, shared dinner" />
      </Field>
      <Field label="Amount owed (SGD)">
        <input style={sx.input} type="number" value={amount}
          onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 45" />
      </Field>
      <Field label="Remind me on">
        <input style={sx.input} type="date" value={dueDate}
          onChange={(e) => setDueDate(e.target.value)} />
      </Field>
      <Field label="Repeat">
        <div style={{ display: "flex", gap: 5 }}>
          {FREQ_OPTIONS.map((f) => (
            <button key={f.key} onClick={() => setFrequency(f.key)} style={{
              ...sx.chip, fontSize: 11,
              background: frequency === f.key ? C.lavDeep : C.lavBg,
              color: frequency === f.key ? "#fff" : C.lavDeep,
            }}>{f.label}</button>
          ))}
        </div>
      </Field>
      {frequency !== "once" && (
        <Field label="Stop repeating after (optional)">
          <input style={sx.input} type="date" value={endDate}
            onChange={(e) => setEndDate(e.target.value)} />
        </Field>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button style={sx.ghostBtn} onClick={onCancel}>Cancel</button>
        <button style={{ ...sx.primaryBtn, opacity: valid ? 1 : 0.5 }} disabled={!valid}
          onClick={() => onAdd({
            who, purpose: purpose || "Money owed", amount: Number(amount),
            dueDate, frequency, endDate: frequency !== "once" ? endDate : "",
          })}>
          Add reminder
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   SUBSCRIPTIONS — RECURRING SPEND TRACKER
   ============================================================ */
const SUB_CYCLES = [
  { key: "monthly", label: "Monthly", perMonth: 1 },
  { key: "yearly", label: "Yearly", perMonth: 1 / 12 },
  { key: "weekly", label: "Weekly", perMonth: 52 / 12 },
];

function Subscriptions({ state, update }) {
  const [adding, setAdding] = useState(false);
  const subs = state.subscriptions || [];

  const monthlyTotal = subs.filter((s) => s.active !== false).reduce((a, s) => {
    const cyc = SUB_CYCLES.find((c) => c.key === s.cycle) || SUB_CYCLES[0];
    return a + s.cost * cyc.perMonth;
  }, 0);

  const enriched = subs.map((s) => {
    const next = nextOccurrence(s.nextRenew, s.cycle === "yearly" ? "monthly" : s.cycle, "");
    return { ...s, days: daysUntil(s.nextRenew) >= 0 ? daysUntil(s.nextRenew) : daysUntil(next), nextShown: daysUntil(s.nextRenew) >= 0 ? s.nextRenew : next };
  }).sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999));

  const subsEnvelope = state.envelopes.find((e) =>
    e.name.toLowerCase().includes("subscription") || e.name.toLowerCase().includes("bills"));

  const addSub = (s) => {
    update((st) => ({ ...st, subscriptions: [{ ...s, id: "sub" + Date.now(), active: true }, ...(st.subscriptions || [])] }));
    setAdding(false);
  };
  const toggle = (id) => update((st) => ({
    ...st, subscriptions: st.subscriptions.map((s) => s.id === id ? { ...s, active: s.active === false } : s),
  }));
  const del = (id) => update((st) => ({ ...st, subscriptions: st.subscriptions.filter((s) => s.id !== id) }));

  // Push the computed monthly total into the subscriptions envelope budget.
  const syncToEnvelope = () => {
    if (!subsEnvelope) return;
    update((st) => ({
      ...st,
      envelopes: st.envelopes.map((e) =>
        e.id === subsEnvelope.id ? { ...e, budget: Math.round(monthlyTotal) } : e),
    }));
  };

  return (
    <div>
      <SectionTitle icon={RefreshCw} title="Subscriptions"
        subtitle="Every recurring charge, and exactly when it hits your account" />

      <div style={sx.statRow}>
        <StatCard label="Cost per month" value={monthlyTotal} accent={C.peachDeep} bg={C.peachBg} icon={RefreshCw} />
        <StatCard label="Cost per year" value={monthlyTotal * 12} accent={C.lavDeep} bg={C.lavBg} icon={CalendarClock} />
      </div>

      <div style={sx.eduStrip}>
        <Lightbulb size={14} color={C.butterDeep} />
        <span><strong>Subscription creep is real:</strong> small monthly charges feel harmless but
          ${Math.round(monthlyTotal)}/month is ${Math.round(monthlyTotal * 12)}/year. Review anything
          you haven't used in the last 30 days.</span>
      </div>

      <div style={sx.eduStrip}>
        <CheckCircle2 size={14} color={C.mintDeep} />
        <span><strong>Payments auto-record:</strong> on each billing date, a ledger transaction is created
          automatically under your Bills &amp; Subscriptions envelope. Pause a subscription to stop this.</span>
      </div>

      {subsEnvelope && subs.length > 0 && (
        <button style={{ ...sx.softBtn, marginBottom: 12 }} onClick={syncToEnvelope}>
          <RefreshCw size={13} /> Set "{subsEnvelope.name}" envelope budget to ${Math.round(monthlyTotal)}
        </button>
      )}

      {subs.length === 0 && !adding && (
        <div style={{ ...sx.card, textAlign: "center", padding: "28px 16px" }}>
          <RefreshCw size={26} color={C.inkFaint} />
          <p style={{ fontSize: 12.5, color: C.inkSoft, margin: "8px 0 0" }}>
            No subscriptions tracked. Add Netflix, Spotify, phone plan, gym — anything that
            auto-charges you.
          </p>
        </div>
      )}

      {enriched.map((s) => {
        const inactive = s.active === false;
        const soon = !inactive && s.days !== null && s.days >= 0 && s.days <= 5;
        const cyc = SUB_CYCLES.find((c) => c.key === s.cycle) || SUB_CYCLES[0];
        return (
          <div key={s.id} style={{
            ...sx.card, marginBottom: 10, opacity: inactive ? 0.55 : 1,
            borderLeft: `4px solid ${inactive ? C.line : soon ? C.butterDeep : C.peach}`,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{s.name}</div>
                <div style={{ fontSize: 11.5, color: C.inkSoft }}>
                  ${s.cost}/{cyc.label.toLowerCase().replace("ly", "")}
                  {s.cycle !== "monthly" && ` · ~$${(s.cost * cyc.perMonth).toFixed(2)}/mo`}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: inactive ? C.inkFaint : C.peachDeep }}>
                  ${s.cost}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              {s.nextRenew && (
                <span style={{
                  fontSize: 10.5, fontWeight: 800, padding: "3px 8px", borderRadius: 6,
                  background: inactive ? C.bg : soon ? C.butterBg : C.skyBg,
                  color: inactive ? C.inkFaint : soon ? C.butterDeep : C.skyDeep,
                }}>
                  <CalendarClock size={10} style={{ verticalAlign: -1, marginRight: 3 }} />
                  {inactive ? "Paused" : `Renews ${dueLabel(s.days).toLowerCase()} · ${fmtDate(s.nextShown)}`}
                </span>
              )}
              <span style={sx.recurTag}>
                <RefreshCw size={9} style={{ verticalAlign: -1, marginRight: 3 }} />
                {cyc.label}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button style={{ ...sx.softBtn, flex: 1,
                background: inactive ? C.mintBg : C.bg, color: inactive ? C.mintDeep : C.inkSoft,
                borderColor: inactive ? C.mint : C.line }}
                onClick={() => toggle(s.id)}>
                {inactive ? "Reactivate" : "Pause / cancelled"}
              </button>
              <button style={{ ...sx.ghostBtn, flex: "0 0 auto", padding: "8px 12px" }}
                onClick={() => del(s.id)}>
                <Trash2 size={13} color={C.inkFaint} />
              </button>
            </div>
          </div>
        );
      })}

      {adding ? (
        <SubscriptionForm onAdd={addSub} onCancel={() => setAdding(false)} />
      ) : (
        <button style={sx.dashedBtn} onClick={() => setAdding(true)}>
          <Plus size={15} /> Add a subscription
        </button>
      )}
    </div>
  );
}

function SubscriptionForm({ onAdd, onCancel }) {
  const [name, setName] = useState("");
  const [cost, setCost] = useState("");
  const [cycle, setCycle] = useState("monthly");
  const [nextRenew, setNextRenew] = useState(todayISO());
  const valid = name && cost && Number(cost) > 0;

  return (
    <div style={sx.card}>
      <h4 style={sx.cardH4}>New subscription</h4>
      <Field label="Service name">
        <input style={sx.input} value={name} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Netflix, Spotify, phone plan" />
      </Field>
      <Field label="Cost (SGD)">
        <input style={sx.input} type="number" value={cost}
          onChange={(e) => setCost(e.target.value)} placeholder="e.g. 16.98" />
      </Field>
      <Field label="Billing cycle">
        <div style={{ display: "flex", gap: 5 }}>
          {SUB_CYCLES.map((c) => (
            <button key={c.key} onClick={() => setCycle(c.key)} style={{
              ...sx.chip, fontSize: 11,
              background: cycle === c.key ? C.lavDeep : C.lavBg,
              color: cycle === c.key ? "#fff" : C.lavDeep,
            }}>{c.label}</button>
          ))}
        </div>
      </Field>
      <Field label="Next renewal / deduction date">
        <input style={sx.input} type="date" value={nextRenew}
          onChange={(e) => setNextRenew(e.target.value)} />
      </Field>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={sx.ghostBtn} onClick={onCancel}>Cancel</button>
        <button style={{ ...sx.primaryBtn, opacity: valid ? 1 : 0.5 }} disabled={!valid}
          onClick={() => onAdd({ name, cost: Number(cost), cycle, nextRenew })}>
          Add subscription
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   AI COACH — CONVERSATIONAL UI
   ============================================================ */
const STARTER_QUESTIONS = [
  "How am I doing this month?",
  "Where should I cut back?",
  "How do I start investing in Singapore?",
  "How much should I save for a BTO?",
  "Are my subscriptions costing too much?",
  "Explain CPF like I'm new to this.",
];

function buildContextSummary(state) {
  const m = buildInsights(state);
  const env = state.envelopes.map((e) =>
    `${e.name} (${e.type}): budget $${e.budget}, spent $${e.spent}`).join("; ");
  const goals = state.goals.map((g) =>
    `${g.name}: $${g.saved}/$${g.target}`).join("; ");
  const flags = m.insights.map((i) => `[${i.sev}] ${i.title}`).join("; ");
  const assets = (state.assets || []).length
    ? (state.assets || []).map((a) => `${a.label} $${Math.round(a.amount)}`).join("; ")
    : "none recorded yet";
  const netWorth = (state.assets || []).reduce((a, x) => a + x.amount, 0);
  const salChanges = (state.salaryHistory || []).length;
  const subs = state.subscriptions || [];
  const subMonthly = subs.filter((s) => s.active !== false).reduce((a, s) => {
    const per = s.cycle === "yearly" ? 1 / 12 : s.cycle === "weekly" ? 52 / 12 : 1;
    return a + s.cost * per;
  }, 0);
  const owed = (state.reminders || []).filter((r) => !r.settled);
  const owedTotal = owed.reduce((a, r) => a + r.amount, 0);
  return `User profile: name ${state.profile.name}, gross salary $${state.profile.grossSalary}/mo, ` +
    `estimated take-home $${Math.round(m.income)}/mo (after CPF). ` +
    `They are a fresh graduate in Singapore starting their first full-time job, with low financial literacy. ` +
    `Assets: ${assets}. Total net worth $${Math.round(netWorth)}. ` +
    `Salary has been updated ${salChanges} time(s). ` +
    `Subscriptions: ${subs.length} tracked, ~$${Math.round(subMonthly)}/mo total. ` +
    `Money owed to them: ${owed.length} item(s) totalling $${Math.round(owedTotal)}. ` +
    `Envelopes: ${env}. Total budgeted $${Math.round(m.totalBudget)}, total spent $${Math.round(m.totalSpent)}. ` +
    `Goals: ${goals}. Current flags: ${flags}.`;
}

function offlineReply(question, state) {
  const m = buildInsights(state);
  const q = question.toLowerCase();
  if (q.includes("how am i") || q.includes("doing")) {
    const top = m.insights.slice(0, 2).map((i) => `• ${i.title}: ${i.body}`).join("\n\n");
    return `Here's your month so far — take-home around $${Math.round(m.income)}, spent $${Math.round(m.totalSpent)}.\n\n${top || "Nothing alarming. Keep logging expenses so I can spot trends."}`;
  }
  if (q.includes("cut") || q.includes("reduce") || q.includes("save money")) {
    const wants = state.envelopes.filter((e) => e.type === "want").sort((a, b) => b.spent - a.spent)[0];
    return `The fastest wins are usually in 'wants'. Your biggest one right now is ${wants ? wants.name + ` at $${Math.round(wants.spent)}` : "not yet logged"}. Try a one-week no-spend challenge there, audit subscriptions you forgot about, and cook two more meals a week. Small recurring cuts beat big one-off sacrifices.`;
  }
  if (q.includes("invest")) {
    return `Starting out in Singapore, a sensible order is:\n\n1. Build your emergency fund fully first.\n2. Make sure no high-interest debt exists.\n3. Then invest regularly — many beginners use a low-cost globally-diversified index fund or ETF, often through a regular savings plan so you invest a fixed sum monthly (this is 'dollar-cost averaging').\n\nKey principles: keep fees low, diversify broadly, invest only money you won't need for 3+ years, and don't try to time the market. This is education, not advice — read up via MoneySense (the government's financial literacy site).`;
  }
  if (q.includes("bto") || q.includes("flat") || q.includes("house")) {
    return `For a BTO flat: your CPF Ordinary Account (OA) does a lot of the heavy lifting — that's the ~62% of your CPF contributions you saw at setup. The cash you'll personally need covers things like the option fee, part of the down payment not coverable by CPF, and renovation. A common approach is a dedicated 'BTO down payment' goal plus a separate 'renovation' goal ($30k-60k is typical). Set target dates and the tracker will tell you how much to set aside monthly.`;
  }
  if (q.includes("cpf")) {
    const c = m.cpf;
    return `CPF is Singapore's forced-savings system. From your salary, 20% goes in as your contribution and your employer adds 17%. For you that's roughly:\n\n• Ordinary Account (~$${Math.round(c.oa)}/mo) — housing, and can be invested\n• Special Account (~$${Math.round(c.sa)}/mo) — retirement, earns higher interest\n• MediSave (~$${Math.round(c.ma)}/mo) — healthcare costs and insurance\n\nIt feels like 'lost' salary but it's genuinely yours — it's funding your future flat and retirement automatically.`;
  }
  if (q.includes("emergency")) {
    const g = state.goals.find((x) => x.icon === "shield");
    return `Your emergency fund is the cash cushion for job loss, medical surprises, or urgent repairs — without borrowing. Aim for 3-6 months of essential expenses${g ? `, so about $${Math.round(g.target)} for you` : ""}. Keep it somewhere safe and accessible (a high-yield savings account), not invested. This comes before investing — always.`;
  }
  if (q.includes("net worth") || q.includes("networth") || q.includes("assets") || q.includes("how much do i have")) {
    const assets = state.assets || [];
    const total = assets.reduce((a, x) => a + x.amount, 0);
    const liquid = assets.filter((x) => assetType(x.type).liquid).reduce((a, x) => a + x.amount, 0);
    if (total === 0) return `You haven't recorded any assets yet. On the Dashboard, tap "Update" on the Net worth card to enter what you have in your savings account, fixed deposits, investments, and CPF. It's stored only on your device.`;
    return `Your recorded net worth is $${Math.round(total).toLocaleString()}. Of that, $${Math.round(liquid).toLocaleString()} is liquid — money you could actually reach in an emergency (savings account, cash). The rest sits in less-accessible places like fixed deposits, investments, or CPF.\n\nWhy the split matters: only liquid money should back your emergency fund. CPF and locked deposits are real wealth but can't be tapped for a surprise bill. Keep updating these balances as they change so your picture stays accurate.`;
  }
  if (q.includes("subscription") || q.includes("subscriptions")) {
    const subs = state.subscriptions || [];
    if (subs.length === 0) return `You haven't tracked any subscriptions yet. Add them in the Subs tab — Netflix, Spotify, phone plan, gym, anything that auto-charges. The tool will total the monthly and yearly cost and remind you before each renewal date.`;
    const monthly = subs.filter((s) => s.active !== false).reduce((a, s) => {
      const per = s.cycle === "yearly" ? 1 / 12 : s.cycle === "weekly" ? 52 / 12 : 1;
      return a + s.cost * per;
    }, 0);
    return `You're tracking ${subs.length} subscription(s), costing about $${Math.round(monthly)}/month — that's $${Math.round(monthly * 12)} a year. The trap with subscriptions is they're individually small and easy to forget. Two quick wins: cancel anything unused in the last 30 days, and switch annual billing on for services you'll definitely keep (usually cheaper). The Subs tab shows each renewal date so nothing surprises you.`;
  }
  if (q.includes("owe") || q.includes("owed") || q.includes("lent") || q.includes("borrow")) {
    const owed = (state.reminders || []).filter((r) => !r.settled);
    const total = owed.reduce((a, r) => a + r.amount, 0);
    if (owed.length === 0) return `Nothing is currently tracked as owed to you. When you lend money or front a shared bill, add it in the Owed tab — you can set a reminder date and even make it recurring. It saves the awkwardness of forgetting who owes what.`;
    return `You have $${Math.round(total)} owed to you across ${owed.length} item(s). That's real money — don't let it quietly become a gift. The Owed tab flags overdue items; a short, friendly message usually settles things. Money owed to you isn't part of your spendable budget until it's actually back in your account.`;
  }
  if (q.includes("debt") || q.includes("loan") || q.includes("credit card")) {
    return `Debt strategy in order of priority:\n\n1. High-interest debt first — credit card debt in Singapore often runs ~25%/year. Clear this before investing or even before topping up savings beyond a starter buffer.\n2. Pay your credit card in full every month. Treat it like a debit card, not extra money.\n3. Lower-interest debt (student loans, etc.) can be paid down steadily while you also save.\n\nThe logic: paying off 25% debt is a guaranteed 25% return — no investment reliably beats that.`;
  }
  if (q.includes("insurance")) {
    return `As a fresh grad, insurance basics worth knowing:\n\n• MediShield Life (via CPF MediSave) covers large hospital bills — you already have this.\n• Many people add an Integrated Shield Plan for better ward coverage.\n• Term life / personal accident insurance matters most once others depend on your income.\n\nGeneral guidance: insure against things that would be financially catastrophic, don't over-insure small risks, and be cautious with policies that bundle investing and insurance — they're often costly. Verify specifics with MoneySense.`;
  }
  if (q.includes("save") && (q.includes("how much") || q.includes("rate") || q.includes("percent"))) {
    const rate = m.income > 0 ? Math.round((m.saveBudget / m.income) * 100) : 0;
    return `You're currently budgeting about ${rate}% of take-home pay to savings. As a fresh grad — usually low fixed costs, possibly living with family — this is your golden window. Aiming for 20%+ now compounds enormously over a career. If you can hit 30-40% early, even better. Automate it: treat savings as a bill that's paid the day your salary lands, before you can spend it.`;
  }
  if (q.includes("budget") || q.includes("envelope") || q.includes("50/30/20") || q.includes("50 30 20")) {
    return `The envelope method gives every dollar a job before the month starts. The 50/30/20 frame is a starting point: ~50% of take-home to needs (rent, food, transport, bills), ~30% to wants (dining, shopping, fun), ~20% to saving and investing.\n\nIf you live with family rent-free, your 'needs' will be far below 50% — push that surplus into saving instead. The tool flags when an envelope is nearly used up so you can slow down before overspending.`;
  }
  if (q.includes("travel") || q.includes("holiday") || q.includes("trip")) {
    return `Travel is a 'sinking fund' — you save gradually for a known future expense instead of taking a big hit in one month. Create a Travel goal, set the target cost and the trip date, and the tracker tells you the monthly amount. Saving $200/mo for 10 months is painless; finding $2,000 the month before is stressful. Keep this money in cash savings, not invested — the timeline is too short for market risk.`;
  }
  if (q.includes("reno")) {
    return `Renovation for a BTO typically runs $30k-60k depending on flat size and how much you do. It can't be paid with CPF (unlike the flat itself), so it needs to be cash. Treat it as its own goal with its own target date — usually keyed to when you collect keys. Because the timeline is several years out but fixed, keep most of it in safe savings as the date approaches rather than invested.`;
  }
  if (q.includes("start") || q.includes("begin") || q.includes("first")) {
    return `If you're just starting out, here's a simple order:\n\n1. Track every expense for one month so you know your real numbers.\n2. Build a starter buffer of $1,000, then grow it to a full 3-6 month emergency fund.\n3. Clear any high-interest debt.\n4. Once the safety net is full, start investing a fixed sum monthly into something low-cost and diversified.\n5. Layer in goals — travel, BTO, reno — as sinking funds with target dates.\n\nDon't rush steps 4 and 5. The foundation matters more than the speed.`;
  }
  return `I can help with budgeting, cutting costs, CPF, investing basics, debt, insurance, savings rate, and planning big goals like a BTO, renovation, or travel. Try one of the suggested questions, or ask me something specific about your numbers. (Tip: the more you log in the Ledger, the sharper my advice gets.)`;
}

function Coach({ state, update }) {
  const [messages, setMessages] = useState(state.chatHistory || []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = React.useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  const persist = (msgs) => {
    setMessages(msgs);
    update((s) => ({ ...s, chatHistory: msgs.slice(-30) }));
  };

  const send = async (text) => {
    const q = (text || input).trim();
    if (!q || busy) return;
    const next = [...messages, { role: "user", content: q }];
    persist(next);
    setInput("");

    // Offline mode: instant, free, zero tokens. No network call at all.
    if (state.coachMode !== "ai") {
      setBusy(true);
      setTimeout(() => {
        persist([...next, { role: "assistant", content: offlineReply(q, state) }]);
        setBusy(false);
      }, 250);
      return;
    }

    setBusy(true);
    try {
      const context = buildContextSummary(state);
      const system = `You are a warm, encouraging personal finance coach for a fresh graduate in Singapore ` +
        `who is just starting their first job and has low financial literacy. Be concrete, kind, and practical. ` +
        `Use Singapore context (CPF, BTO, HDB, MoneySense, SGD). Keep replies under 160 words, conversational, ` +
        `and free of jargon unless you explain it. When relevant, reference their actual numbers. ` +
        `Always frame investing guidance as general education, never as personalised financial advice, ` +
        `and remind them to verify with official sources for big decisions. ` +
        `Here is their current financial data: ${context}`;
      // Token economy: only send last 4 turns, cap output low.
      const apiMessages = next.slice(-4).map((m) => ({ role: m.role, content: m.content }));

      const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("no-key");
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 600,
          system,
          messages: apiMessages,
        }),
      });
      if (!res.ok) throw new Error("api");
      const data = await res.json();
      const reply = data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      persist([...next, { role: "assistant", content: reply || offlineReply(q, state) }]);
    } catch (e) {
      persist([...next, { role: "assistant", content: offlineReply(q, state) }]);
    } finally {
      setBusy(false);
    }
  };

  const aiMode = state.coachMode === "ai";
  const setMode = (mode) => update((s) => ({ ...s, coachMode: mode }));

  return (
    <div>
      <SectionTitle icon={Sparkles} title="AI money coach"
        subtitle="Ask anything — it knows your numbers and Singapore's system" />

      <div style={sx.modeBar}>
        <div style={{ display: "flex", gap: 4, background: C.bg, borderRadius: 9, padding: 3 }}>
          <button onClick={() => setMode("offline")} style={{
            ...sx.modeBtn,
            background: !aiMode ? C.mintDeep : "transparent",
            color: !aiMode ? "#fff" : C.inkSoft,
          }}>Free mode</button>
          <button onClick={() => setMode("ai")} style={{
            ...sx.modeBtn,
            background: aiMode ? C.lavDeep : "transparent",
            color: aiMode ? "#fff" : C.inkSoft,
          }}>AI mode</button>
        </div>
        <span style={{ fontSize: 10.5, color: C.inkFaint, lineHeight: 1.4, flex: 1 }}>
          {aiMode
            ? "Richer answers via Anthropic API. Uses tokens — needs Pro / API access."
            : "Built-in SG knowledge base. Instant, zero tokens, works forever."}
        </span>
      </div>

      <div style={sx.chatWindow} ref={scrollRef}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", padding: "20px 12px" }}>
            <div style={{ ...sx.logoMark, margin: "0 auto 10px", width: 40, height: 40 }}>
              <Sparkles size={20} color="#fff" />
            </div>
            <p style={{ fontSize: 13, color: C.ink, fontWeight: 600, margin: 0 }}>
              Hi {state.profile.name}! I'm your money coach.
            </p>
            <p style={{ fontSize: 12, color: C.inkSoft, margin: "4px 0 0", lineHeight: 1.5 }}>
              I can see your budget and goals. Ask me how you're doing, what to cut,
              or how to start investing. Pick a question to begin:
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start",
            marginBottom: 10,
          }}>
            <div style={m.role === "user" ? sx.bubbleUser : sx.bubbleAi}>
              {m.content.split("\n").map((line, j) => (
                <p key={j} style={{ margin: j === 0 ? 0 : "6px 0 0", whiteSpace: "pre-wrap" }}>{line}</p>
              ))}
            </div>
          </div>
        ))}
        {busy && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div style={{ ...sx.bubbleAi, color: C.inkFaint }}>
              <span className="typing">Thinking</span>
            </div>
          </div>
        )}
      </div>

      {messages.length === 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "10px 2px" }}>
          {STARTER_QUESTIONS.map((q) => (
            <button key={q} style={sx.suggestChip} onClick={() => send(q)}>{q}</button>
          ))}
        </div>
      )}

      <div style={sx.chatInputRow}>
        <input
          style={{ ...sx.input, flex: 1, marginBottom: 0 }}
          placeholder="Ask your money coach…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
        />
        <button style={{ ...sx.primaryBtn, flex: "0 0 auto", padding: "0 14px",
          opacity: input.trim() && !busy ? 1 : 0.5 }}
          disabled={!input.trim() || busy} onClick={() => send()}>
          <ArrowRight size={16} />
        </button>
      </div>
      <p style={{ fontSize: 10.5, color: C.inkFaint, textAlign: "center", margin: "8px 0 0" }}>
        Educational guidance only — not licensed financial advice.
      </p>
    </div>
  );
}

/* ============================================================
   STYLES
   ============================================================ */
const sx = {
  app: {
    fontFamily: "'Nunito', 'Segoe UI', system-ui, sans-serif",
    background: C.bg, color: C.ink, maxWidth: 760, margin: "0 auto",
    borderRadius: 18, overflow: "hidden", border: `1px solid ${C.line}`,
  },
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "16px 18px", background: C.card, borderBottom: `1px solid ${C.line}`,
    position: "relative",
  },
  logoMark: {
    width: 38, height: 38, borderRadius: 12, background: `linear-gradient(135deg, ${C.lavDeep}, ${C.lav})`,
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  nav: {
    display: "flex", gap: 4, padding: "10px 12px", background: C.card,
    borderBottom: `1px solid ${C.line}`, overflowX: "auto",
  },
  navBtn: {
    display: "flex", alignItems: "center", gap: 6, padding: "8px 13px",
    borderRadius: 11, border: "none", cursor: "pointer", fontSize: 12.5,
    fontWeight: 700, fontFamily: "inherit", whiteSpace: "nowrap",
    transition: "all .18s ease",
  },
  main: { padding: "18px 16px 8px" },
  footer: {
    fontSize: 10, color: C.inkFaint, textAlign: "center", padding: "10px 16px 16px",
    lineHeight: 1.5,
  },
  card: {
    background: C.card, borderRadius: 14, padding: "14px 16px",
    border: `1px solid ${C.line}`, marginBottom: 14,
  },
  cardH4: { margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: C.ink },
  statRow: { display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" },
  statCard: {
    flex: 1, minWidth: 150, borderRadius: 14, padding: "13px 15px",
  },
  chartRow: { display: "flex", gap: 12, flexWrap: "wrap" },
  track: {
    height: 8, background: C.line, borderRadius: 99, overflow: "hidden", width: "100%",
  },
  fill: { height: "100%", borderRadius: 99, transition: "width .4s ease" },
  tooltip: {
    background: C.card, border: `1px solid ${C.line}`, borderRadius: 10,
    fontSize: 11.5, fontFamily: "'Nunito', sans-serif",
  },
  linkBtn: {
    display: "flex", alignItems: "center", gap: 2, background: "none", border: "none",
    color: C.lavDeep, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  },
  // onboarding
  onbWrap: { padding: "22px 20px 26px" },
  onbDots: { display: "flex", gap: 6, margin: "16px 0" },
  onbDot: { height: 5, flex: 1, borderRadius: 99, transition: "background .3s" },
  onbCard: {
    background: C.card, borderRadius: 16, padding: "20px 18px", border: `1px solid ${C.line}`,
  },
  onbBadge: {
    display: "inline-flex", alignItems: "center", gap: 5, background: C.lavBg,
    color: C.lavDeep, fontSize: 11, fontWeight: 800, padding: "4px 10px",
    borderRadius: 99, marginBottom: 10,
  },
  onbH2: { margin: "0 0 6px", fontSize: 18, color: C.ink, letterSpacing: -0.3 },
  onbP: { fontSize: 13, color: C.inkSoft, lineHeight: 1.6, margin: "0 0 16px" },
  cpfBox: {
    background: C.skyBg, borderRadius: 12, padding: "12px 13px", margin: "4px 0 16px",
  },
  cpfGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(95px,1fr))", gap: 6 },
  tipBox: {
    display: "flex", gap: 9, background: C.butterBg, borderRadius: 12,
    padding: "11px 12px", margin: "4px 0 16px", alignItems: "flex-start",
  },
  eduStrip: {
    display: "flex", gap: 8, alignItems: "flex-start", background: C.lavBg,
    borderRadius: 11, padding: "10px 12px", marginBottom: 14, fontSize: 11.5,
    color: C.ink, lineHeight: 1.55,
  },
  // inputs
  label: { display: "block", fontSize: 12, fontWeight: 700, color: C.inkSoft, marginBottom: 5 },
  liquidTag: {
    fontSize: 9.5, fontWeight: 800, color: C.skyDeep, background: C.skyBg,
    padding: "2px 6px", borderRadius: 5, marginLeft: 6,
  },
  recurTag: {
    fontSize: 10, fontWeight: 800, color: C.lavDeep, background: C.lavBg,
    padding: "3px 8px", borderRadius: 6, textTransform: "capitalize",
  },
  input: {
    width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.line}`,
    fontSize: 13, fontFamily: "inherit", color: C.ink, background: C.bg,
    boxSizing: "border-box", outline: "none",
  },
  miniInput: {
    width: 70, padding: "5px 8px", borderRadius: 8, border: `1px solid ${C.line}`,
    fontSize: 12.5, fontFamily: "inherit", color: C.ink, background: C.bg,
    textAlign: "right", outline: "none", fontWeight: 700,
  },
  miniSelect: {
    padding: "6px 10px", borderRadius: 9, border: `1px solid ${C.line}`,
    fontSize: 12, fontFamily: "inherit", color: C.ink, background: C.card, outline: "none",
  },
  primaryBtn: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
    padding: "11px 16px", borderRadius: 11, border: "none", cursor: "pointer",
    background: C.lavDeep, color: "#fff", fontSize: 13, fontWeight: 800,
    fontFamily: "inherit", flex: 1, transition: "transform .1s",
  },
  ghostBtn: {
    padding: "11px 16px", borderRadius: 11, border: `1px solid ${C.line}`,
    cursor: "pointer", background: C.card, color: C.inkSoft, fontSize: 13,
    fontWeight: 700, fontFamily: "inherit",
  },
  softBtn: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
    padding: "8px 12px", borderRadius: 9, border: `1px solid ${C.lav}`,
    cursor: "pointer", background: C.lavBg, color: C.lavDeep, fontSize: 11.5,
    fontWeight: 700, fontFamily: "inherit", width: "100%",
  },
  dashedBtn: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
    padding: "13px", borderRadius: 12, border: `1.5px dashed ${C.lav}`,
    cursor: "pointer", background: "transparent", color: C.lavDeep, fontSize: 12.5,
    fontWeight: 700, fontFamily: "inherit", width: "100%", marginBottom: 14,
  },
  iconBtn: {
    width: 34, height: 34, borderRadius: 9, border: `1px solid ${C.line}`,
    background: C.card, cursor: "pointer", display: "flex", alignItems: "center",
    justifyContent: "center",
  },
  miniIconBtn: {
    width: 26, height: 26, borderRadius: 7, border: "none", background: "transparent",
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
  },
  chip: {
    padding: "6px 12px", borderRadius: 99, border: "none", cursor: "pointer",
    fontSize: 11.5, fontWeight: 800, fontFamily: "inherit", flex: 1,
  },
  // envelope
  envCard: {
    background: C.card, borderRadius: 11, padding: "11px 13px",
    border: `1px solid ${C.line}`, marginBottom: 8,
  },
  // ledger
  ledgerForm: { display: "flex", gap: 8, flexWrap: "wrap" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  th: {
    textAlign: "left", padding: "6px 8px", fontSize: 10.5, fontWeight: 800,
    color: C.inkFaint, textTransform: "uppercase", letterSpacing: 0.4,
    borderBottom: `1px solid ${C.line}`,
  },
  td: { padding: "9px 8px", borderBottom: `1px solid ${C.line}`, color: C.inkSoft },
  // goal
  goalCard: {
    background: C.card, borderRadius: 14, padding: "14px 15px",
    border: `1px solid ${C.line}`, marginBottom: 12,
  },
  goalIcon: {
    width: 38, height: 38, borderRadius: 11, background: C.lavBg,
    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19,
    flexShrink: 0,
  },
  // chat
  chatWindow: {
    background: C.card, borderRadius: 14, border: `1px solid ${C.line}`,
    padding: "14px", height: 340, overflowY: "auto", marginBottom: 4,
  },
  bubbleUser: {
    background: C.lavDeep, color: "#fff", padding: "9px 13px", borderRadius: "13px 13px 4px 13px",
    fontSize: 12.5, maxWidth: "78%", lineHeight: 1.5,
  },
  bubbleAi: {
    background: C.bg, color: C.ink, padding: "9px 13px", borderRadius: "13px 13px 13px 4px",
    fontSize: 12.5, maxWidth: "85%", lineHeight: 1.55, border: `1px solid ${C.line}`,
  },
  suggestChip: {
    padding: "7px 12px", borderRadius: 99, border: `1px solid ${C.lav}`,
    background: C.lavBg, color: C.lavDeep, fontSize: 11.5, fontWeight: 700,
    cursor: "pointer", fontFamily: "inherit",
  },
  chatInputRow: { display: "flex", gap: 8, marginTop: 8 },
  modeBar: {
    display: "flex", alignItems: "center", gap: 10, marginBottom: 10,
    background: C.card, borderRadius: 11, padding: "8px 10px", border: `1px solid ${C.line}`,
  },
  modeBtn: {
    padding: "5px 11px", borderRadius: 7, border: "none", cursor: "pointer",
    fontSize: 11, fontWeight: 800, fontFamily: "inherit", whiteSpace: "nowrap",
  },
  // modal
  modalOverlay: {
    position: "absolute", inset: 0, background: "rgba(58,58,74,0.35)",
    display: "flex", alignItems: "flex-start", justifyContent: "center",
    paddingTop: 70, zIndex: 50,
  },
  modal: {
    background: C.card, borderRadius: 16, padding: "18px", width: 300,
    border: `1px solid ${C.line}`,
  },
  histRow: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "8px 0", borderBottom: `1px solid ${C.line}`,
  },
  assetCard: {
    display: "flex", alignItems: "center", gap: 10, background: C.card,
    borderRadius: 11, padding: "10px 12px", border: `1px solid ${C.line}`,
    marginBottom: 8,
  },
  assetIcon: {
    width: 36, height: 36, borderRadius: 10, display: "flex",
    alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0,
  },
};

const globalCss = `
  @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap');
  * { box-sizing: border-box; }
  ::-webkit-scrollbar { width: 7px; height: 7px; }
  ::-webkit-scrollbar-thumb { background: ${C.line}; border-radius: 99px; }
  ::-webkit-scrollbar-track { background: transparent; }
  input:focus, select:focus { border-color: ${C.lavDeep} !important; }
  button:active { transform: scale(0.97); }
  .typing::after { content: '...'; animation: dots 1.2s infinite; }
  @keyframes dots { 0%,20%{content:'.'} 40%{content:'..'} 60%,100%{content:'...'} }
  @media (max-width: 520px) {
    .navLabel { display: none; }
  }
`;
