import type { EscalationPriority } from '@/lib/types';

// Multilingual (English + Setswana) safety pre-check that runs BEFORE the LLM.
// It is intentionally simple and transparent: keyword + intent patterns per
// category. A human-reviewed keyword list should be maintained by TWC.
// If matched, we escalate immediately and short-circuit the model.

export type SafetyCategory =
  | 'pep_exposure'
  | 'sexual_assault'
  | 'self_harm'
  | 'bleeding_pain'
  | 'pregnancy_emergency'
  | 'infant_illness'
  | 'ipv';

export type SafetyHit = {
  category: SafetyCategory;
  priority: EscalationPriority;
  // Short, non-sensitive category label for the escalation summary.
  label: string;
};

type Rule = {
  category: SafetyCategory;
  priority: EscalationPriority;
  label: string;
  patterns: RegExp[];
};

const RULES: Rule[] = [
  {
    category: 'pep_exposure',
    priority: 'critical',
    label: 'Possible HIV exposure / PEP window',
    patterns: [
      /condom\s*(broke|burst|slipped|came off)/i,
      /\b(pep|post[- ]?exposure)\b/i,
      /possible (hiv )?exposure/i,
      /exposed to hiv/i,
      /had (unprotected|unsafe) sex/i,
      /rape|raped/i,
      /tshwarwa|tshwarwa ke monna|ka tlhoka tshireletso/i,
    ],
  },
  {
    category: 'sexual_assault',
    priority: 'critical',
    label: 'Possible sexual assault or abuse',
    patterns: [
      /\b(sexual )?assault(ed)?\b/i,
      /\babuse(d)?\b/i,
      /forced (me )?to have sex/i,
      /\brape|raped\b/i,
      /a ntlhokisa|a nthata ka dikgoka/i,
    ],
  },
  {
    category: 'self_harm',
    priority: 'critical',
    label: 'Possible self-harm or suicidal thoughts',
    patterns: [
      /kill myself|end my life|suicid/i,
      /want to die|better off dead|no reason to live/i,
      /hurt myself|harm myself|cut myself/i,
      /go ipolaya|ke batla go swa|ga ke sa batle go tshela/i,
    ],
  },
  {
    category: 'bleeding_pain',
    priority: 'critical',
    label: 'Severe bleeding or pain',
    patterns: [
      /severe (bleeding|pain)/i,
      /bleeding heavily|won'?t stop bleeding|heavy bleeding/i,
      /unbearable pain|worst pain/i,
      /madi a mantsi|botlhoko jo bogolo thata/i,
    ],
  },
  {
    category: 'pregnancy_emergency',
    priority: 'critical',
    label: 'Possible pregnancy emergency',
    patterns: [
      /pregnan.*(bleeding|pain|emergency|no movement)/i,
      /bleeding.*pregnan/i,
      /water broke|waters broke|in labour|in labor/i,
      /baby is not moving|baby hasn'?t moved/i,
    ],
  },
  {
    category: 'infant_illness',
    priority: 'high',
    label: 'Possible seriously ill infant',
    patterns: [
      /(newborn|baby|infant).*(fever|not (feeding|breathing)|convulsion|seizure|very sick)/i,
      /(fever|not breathing|convulsion|seizure).*(newborn|baby|infant)/i,
      /ngwana.*(a lwala thata|ga a je|ga a heme)/i,
    ],
  },
  {
    category: 'ipv',
    priority: 'critical',
    label: 'Possible intimate partner violence',
    patterns: [
      /my (partner|husband|boyfriend|wife).*(hit|beat|hurt|threaten|abuse)/i,
      /(afraid|scared) (of|for).*(partner|husband|boyfriend|wife)/i,
      /domestic (violence|abuse)/i,
      /monna wa me.*a ntlhaba|a ntlhase/i,
    ],
  },
];

export function precheckSafety(text: string): SafetyHit | null {
  const t = text.trim();
  if (!t) return null;
  for (const rule of RULES) {
    for (const p of rule.patterns) {
      if (p.test(t)) {
        return { category: rule.category, priority: rule.priority, label: rule.label };
      }
    }
  }
  return null;
}

// Prompt-injection heuristics. We do not hard-block; we neutralise + log.
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all|any|the|previous|above) (instructions|rules|prompt)/i,
  /you are now|act as|pretend to be/i,
  /reveal (your )?(system )?(prompt|instructions|rules)/i,
  /disregard .*(rules|instructions)/i,
  /\bdeveloper mode\b|\bjailbreak\b/i,
  /translate .*(rules|prompt).*into/i,
];

export function detectInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((p) => p.test(text));
}
