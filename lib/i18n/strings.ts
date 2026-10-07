// UI strings. Setswana strings are [NATIVE REVIEW] — kept here so a Setswana
// speaker can review/approve before launch. Do not hardcode user-facing copy elsewhere.

export type Lang = 'en' | 'tn';

type Dict = Record<string, string>;

const en: Dict = {
  appName: 'TWC Assistant',
  tagline: 'One chat for every need — bookings, services and approved health information.',
  placeholder: "Let's chat…",
  send: 'Send',
  autoRead: 'Auto-read replies',
  voiceEnglishOnly: 'Voice is available in English',
  talkToPerson: 'Talk to a person',
  sourcePrefix: 'Source',
  sourceChip: 'TWC approved content',
  escalated: 'A TWC team member has been notified.',
  escalatedMeta: 'Typical reply within working hours. Outside hours you will get a message when the team is back.',
  emergency: 'If this is an emergency, call 997 (ambulance) or go to your nearest clinic now.',
  errorGeneric: 'Something went wrong. Please try again.',
  newChat: 'New chat',
  statusOnline: 'Online',
  uploadDoc: 'Upload document',
  uploadHint: 'Photo or PDF (max 2MB). We delete it automatically after 7 days.',
  uploadReading: 'Reading your document…',
  uploadFailed: "I couldn't read this clearly, can you retake the photo?",
};

const tn: Dict = {
  // [NATIVE REVIEW]
  appName: 'Thuso ya TWC',
  tagline: 'Puisano e le nngwe ya dilo tsotlhe — dibuka, ditirelo le tshedimosetso e e letleletsweng.',
  placeholder: 'A re bueng…',
  send: 'Romela',
  autoRead: 'Bala dikarabo ka boene',
  voiceEnglishOnly: 'Lentswe le teng ka Sekgowa fela',
  talkToPerson: 'Bua le motho',
  sourcePrefix: 'Motswedi',
  sourceChip: 'Diteng tse di letleletsweng tsa TWC',
  escalated: 'Leloko la setlhopha sa TWC le itsisitswe.',
  escalatedMeta: 'Karabo e tla mo nako ya tiro. Kwa ntle ga nako, o tla bona molaetsa fa setlhopha se boa.',
  emergency: 'Fa e le tshoganyetso, leletsa 997 kgotsa ya kwa kliniking ya gago gaufi jaanong.',
  errorGeneric: 'Sengwe se sentse. Tsweetswee leka gape.',
  newChat: 'Puisano e ntšha',
  statusOnline: 'Mo inthaneteng',
  uploadDoc: 'Tsenya lokwalo',
  uploadHint: 'Senepe kgotsa PDF (bokete jo bo kwa tlase ga 2MB). Re a phimola morago ga malatsi a 7.',
  uploadReading: 'Re bala lokwalo lwa gago…',
  uploadFailed: 'Ga ke a kgona go e bala sentle, a o ka tsaya senepe gape?',
};

const DICTS: Record<Lang, Dict> = { en, tn };

export function t(key: string, lang: Lang = 'en'): string {
  return DICTS[lang]?.[key] ?? DICTS.en[key] ?? key;
}

export function allStrings(lang: Lang): Dict {
  return { ...DICTS.en, ...DICTS[lang] };
}
