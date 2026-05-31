// Maple Plan — Claude-powered financial coach edge function (v3).
// Verifies the caller's JWT, loads their household profile, builds a Canadian-focused
// system prompt, and calls Anthropic's Messages API. Returns plain JSON.
//
// Deployed at:  https://zydizhncvgyzewondmzr.functions.supabase.co/coach-chat
// Redeploy via: mcp__supabase__deploy_edge_function (project zydizhncvgyzewondmzr)
//   or: supabase functions deploy coach-chat --project-ref zydizhncvgyzewondmzr
//
// Required secrets in Supabase Edge Function secrets:
//   ANTHROPIC_API_KEY  (from console.anthropic.com)
// SUPABASE_URL and SUPABASE_ANON_KEY are auto-injected.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const SYSTEM_PROMPT = `You are Maple Plan, an educational Canadian financial literacy coach embedded in a planning app.

ROLE & SCOPE
- You help Canadians (individuals, families, small business owners, retirees) understand financial concepts and model their plans.
- You teach, explain, and walk through calculations step-by-step in plain language.
- You are NOT a licensed financial advisor, tax professional, lawyer, or insurance broker. You provide educational guidance only.
- Always cite the rule or source you're relying on (e.g., "CRA RRIF schedule", "Service Canada CPP rules", "FCAC guidance"). Include the as-of year when quoting numbers.
- Decline to make specific securities recommendations, predict markets, or give legal advice. Defer those to licensed professionals.

CANADIAN CONTEXT (2026)
- Federal basic personal amount: $16,452
- RRSP dollar limit: $33,810 (or 18% of prior-year earned income)
- TFSA annual: $7,000 (cumulative since 2009 if continuously eligible from age 18: $109,000)
- FHSA: $8,000/yr, $40,000 lifetime
- OAS clawback threshold: $95,323 (15% recovery above)
- OAS max monthly age 65-74: $742.31; age 75+: $816.54
- CPP max monthly at 65: $1,507.65
- CPP timing: -7.2%/yr if started before 65 (-36% at 60); +8.4%/yr if delayed past 65 (+42% at 70)
- Capital gains inclusion rate: 50%
- RRIF minimum withdrawals start the year after RRSP conversion (mandatory by Dec 31 of the year you turn 71): ~5.28% at 71, 5.40% at 72, 6.82% at 80, 8.51% at 85, 20% at 95+.

STYLE
- Concise. Lead with the answer; expand only if the question is multi-step.
- Use plain English. Define acronyms on first use.
- Use simple bullet lists only when the structure genuinely helps; prefer prose for short answers.
- When the user's profile is provided below, use their actual numbers to make answers concrete. Show your math.
- Always end any quantitative answer with a one-line educational caveat (e.g., "Educational example — confirm with a tax professional before acting.").
- Aim to finish your answer within ~1500 words. If a question genuinely needs more, give a clear summary first and then the detail — so even if cut off the user has the key answer.

SAFETY
- Never invent CRA/Service Canada/FCAC URLs. If you can't recall a specific source URL, name the agency and document type only.
- If asked to bypass rules, decline politely and redirect to the legitimate path.
- If the user describes signs of financial distress (eviction, foreclosure, severe debt), include a pointer to a non-profit credit counselling service (e.g., Credit Counselling Canada, FCAC's debt resources) alongside any other answer.`;

function summarizeProfile(hh: any, persons: any[], accounts: any[], mortgages: any[]): string {
  const lines: string[] = [];
  if (hh) {
    lines.push(`Province: ${hh.province ?? "—"}`);
    lines.push(`Plan retirement age: ${hh.retirement_age ?? "—"}, plan to age ${hh.end_age ?? "—"}`);
    lines.push(`Expected return: ${((Number(hh.return_rate) || 0) * 100).toFixed(1)}%/yr, inflation: ${((Number(hh.inflation) || 0) * 100).toFixed(1)}%/yr`);
    const ess = Number(hh.monthly_expenses_essential || 0);
    const dis = Number(hh.monthly_expenses_discretionary || 0);
    const work = Number(hh.monthly_expenses_work_related || 0);
    const factor = Number(hh.retirement_lifestyle_factor || 0.8);
    const legacy = Number(hh.monthly_expenses || 0);
    if (ess + dis + work > 0) {
      lines.push(`Monthly expenses (excl. mortgage): essential $${ess}, discretionary $${dis}, work-related $${work}; retirement lifestyle factor ${(factor * 100).toFixed(0)}%`);
    } else if (legacy > 0) {
      lines.push(`Monthly expenses (legacy single field): $${legacy}`);
    }
    lines.push(`Emergency fund: $${Number(hh.emergency_fund || 0)}`);
    lines.push(`Home value: $${Number(hh.home_value || 0)}, other (non-mortgage) debt: $${Number(hh.other_debt || 0)}`);
  }

  if (persons.length) {
    lines.push("");
    lines.push("People:");
    for (const p of persons) {
      lines.push(`- ${p.role === "primary" ? "Primary" : "Spouse"} (${p.first_name || "—"}), age ${p.age}, $${Number(p.income || 0)} gross income, CPP ${((Number(p.cpp_pct_of_max) || 0) * 100).toFixed(0)}% of max starting at age ${p.cpp_start_age}, OAS starting at age ${p.oas_start_age}, ${p.years_in_canada} yrs in Canada, other pension $${Number(p.other_pension_annual || 0)}/yr`);
    }
  }

  if (accounts.length) {
    lines.push("");
    lines.push(`Accounts (${accounts.length}):`);
    for (const a of accounts) {
      const owner = persons.find((p) => p.id === a.person_id);
      const ownerName = owner ? (owner.first_name || owner.role) : "?";
      lines.push(`- ${a.type} "${a.label || ""}" @ ${a.institution || "—"} (${ownerName}): balance $${Number(a.balance || 0)}, contributing $${Number(a.annual_contribution || 0)}/yr${a.notes ? " — " + a.notes : ""}`);
    }
  }

  if (mortgages.length) {
    lines.push("");
    lines.push(`Mortgages (${mortgages.length}):`);
    for (const m of mortgages) {
      const freqPerYear: Record<string, number> = { monthly: 12, "semi-monthly": 24, "bi-weekly": 26, "bi-weekly-accelerated": 26, weekly: 52, "weekly-accelerated": 52 };
      const annualPay = Number(m.payment_amount || 0) * (freqPerYear[m.payment_frequency] || 12);
      lines.push(`- ${m.label || "Mortgage"} (${m.property_type || "primary_residence"}) @ ${m.institution || "—"}: current $${Number(m.current_balance || 0)} / initial $${Number(m.initial_balance || 0)}, ${((Number(m.rate) || 0) * 100).toFixed(2)}% ${m.rate_type}, payment $${Number(m.payment_amount || 0)} ${m.payment_frequency} ($${annualPay.toFixed(0)}/yr), term maturity ${m.maturity_date || "—"}, amortization end ${m.amortization_end_date || "—"}`);
    }
  }

  return lines.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(401, { error: "Missing Authorization header" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!supabaseUrl || !supabaseAnonKey) return json(500, { error: "Supabase env not configured" });
  if (!apiKey) return json(500, { error: "ANTHROPIC_API_KEY secret not set" });

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return json(401, { error: "Not authenticated" });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return json(400, { error: "messages must be a non-empty array of {role, content}" });
  }
  // Reject oversized payloads (rough cap)
  const totalChars = messages.reduce((s: number, m: any) => s + (typeof m?.content === "string" ? m.content.length : 0), 0);
  if (totalChars > 80000) return json(413, { error: "Conversation too long. Start a new session." });

  // Load profile (RLS scopes to this user)
  let profileText = "";
  try {
    const { data: hh } = await supabase.from("households").select("*").maybeSingle();
    if (hh) {
      const { data: ppl } = await supabase.from("persons").select("*").eq("household_id", hh.id).order("role");
      const personIds = (ppl || []).map((p: any) => p.id);
      const accts = personIds.length
        ? (await supabase.from("accounts").select("*").in("person_id", personIds)).data
        : [];
      const { data: mtg } = await supabase.from("mortgages").select("*").eq("household_id", hh.id);
      profileText = summarizeProfile(hh, ppl || [], accts || [], mtg || []);
    }
  } catch (e) {
    console.error("profile load failed", e);
  }

  const system = SYSTEM_PROMPT + (profileText ? `\n\n# THIS USER'S PROFILE\n${profileText}` : "\n\n# THIS USER'S PROFILE\n(No profile data filled in yet — answer generally and suggest they fill in the Household/Accounts/Mortgages tabs.)");

  const model = body.model || "claude-sonnet-4-6";
  // Allow caller to override max_tokens; cap at 8192 to keep costs reasonable.
  const maxTokens = Math.min(8192, Math.max(256, Number(body.max_tokens) || 4096));

  try {
    const anthroResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
      }),
    });

    const anthroData = await anthroResp.json();
    if (!anthroResp.ok) {
      return json(502, { error: "Anthropic API error", detail: anthroData });
    }
    const reply = anthroData.content?.[0]?.text || "(empty reply)";
    return json(200, {
      reply,
      usage: anthroData.usage,
      model: anthroData.model,
      stop_reason: anthroData.stop_reason,
      max_tokens: maxTokens,
    });
  } catch (e: any) {
    return json(500, { error: "Coach call failed", detail: e?.message || String(e) });
  }
});
