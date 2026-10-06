// KB chunks from docs/sample_data.txt Part 3.
// IMPORTANT: These are DRAFT demo chunks (status forced to "approved" for the
// demo). In production they are governed in kb_sources with owner/approver/version.
// This file is the single source of truth for both Pinecone ingestion and the
// local (no-Pinecone) fallback retriever.

export type KbChunk = {
  id: string;
  category: string;
  audience: string;
  language: string;
  status: 'approved' | 'draft' | 'retired';
  title: string;
  text: string;
};

export const KB_CHUNKS: KbChunk[] = [
  { id: 'KB-001', category: 'about', audience: 'all', language: 'en', status: 'approved', title: 'About TWC',
    text: 'Tebelopele Wellness Centre (TWC) is a non-governmental community health organisation in Botswana with more than two decades of experience in HIV prevention, testing, treatment and care, and integrated primary health services. TWC works with the Government of Botswana, the Ministry of Health, NAHPA, district health structures and community organisations.' },
  { id: 'KB-002', category: 'services', audience: 'all', language: 'en', status: 'approved', title: 'Services overview',
    text: 'TWC offers HIV testing and counselling, treatment follow-up and refills, PrEP, urgent post-exposure care (PEP), STI screening and treatment, family planning, TB screening, cervical cancer screening, male circumcision, counselling, safe-space support, youth-friendly sessions and self-test kits. Not every centre offers every service. The assistant can show which centre offers what.' },
  { id: 'KB-003', category: 'privacy', audience: 'all', language: 'en', status: 'approved', title: 'Confidentiality',
    text: 'Your health information is confidential. TWC staff who need it to care for you can see it. We do not share your information without your consent except where the law requires it. You can ask what we hold about you and ask for it to be corrected or deleted. [CONFIRM against TWC privacy policy and Botswana\'s Data Protection Act]' },
  { id: 'KB-004', category: 'booking', audience: 'all', language: 'en', status: 'approved', title: 'Before your appointment',
    text: 'Please arrive 10 minutes early. If you cannot come, cancel or reschedule at least [CONFIRM: 4] hours before so someone else can use the slot. If you are more than [CONFIRM: 20] minutes late we may ask you to rebook or wait for the next free slot.' },
  { id: 'KB-005', category: 'booking', audience: 'all', language: 'en', status: 'approved', title: 'Walk-ins and bookings',
    text: 'Walk-ins are welcome for testing, STI screening, TB screening, self-test kits and urgent care. Booked appointments are recommended for PrEP, cervical screening, circumcision, counselling and youth sessions, and are seen first at their booked time.' },
  { id: 'KB-006', category: 'preparation', audience: 'all', language: 'en', status: 'approved', title: 'What to bring',
    text: 'Bring your Omang or another form of ID, your appointment card or reference number, any referral letter, and your medication or clinic card if you are on treatment. You can bring a friend or family member for support. If you are under 18, check the youth service information for what is needed.' },
  { id: 'KB-007', category: 'fees', audience: 'all', language: 'en', status: 'approved', title: 'Fees',
    text: '[CONFIRM] Most TWC services are provided free or at low cost. The assistant must not state prices unless this chunk is replaced with TWC\'s confirmed fee schedule.' },
  { id: 'KB-008', category: 'hiv_testing', audience: 'adult', language: 'en', status: 'approved', title: 'How HIV testing works',
    text: 'An HIV test at TWC is confidential and usually a quick finger-prick test, with results in about 20 to 30 minutes. A counsellor talks with you before and after the test, and explains the result in private. If the result is positive, you can start the next steps the same day, including treatment. Testing is voluntary.' },
  { id: 'KB-009', category: 'hiv_testing', audience: 'adult', language: 'en', status: 'approved', title: 'Window period',
    text: 'After a possible exposure, a test may not show an infection straight away because the body needs time to respond (the "window period"). A counsellor will tell you if you should test again later. If the exposure was within the last 72 hours, ask about PEP urgently.' },
  { id: 'KB-010', category: 'hiv_testing', audience: 'adult', language: 'en', status: 'approved', title: 'Self-test kits',
    text: 'HIV self-test kits let you test privately. Kits come with instructions. If the self-test is positive or unclear, visit a TWC centre or clinic for a confirmation test and support. A negative result soon after a possible exposure may need a repeat test.' },
  { id: 'KB-011', category: 'treatment', audience: 'adult', language: 'en', status: 'approved', title: 'HIV treatment (ART)',
    text: 'HIV treatment (ART) is taken every day. It lowers the amount of virus in the blood (viral load) and keeps people healthy. Taking it at the same time daily, using reminders, and collecting refills before they run out all help. Talk to your nurse if you have side effects: do not stop treatment without advice.' },
  { id: 'KB-012', category: 'treatment', audience: 'adult', language: 'en', status: 'approved', title: 'Undetectable = untransmittable',
    text: '"Undetectable = untransmittable (U=U)": a person on effective HIV treatment who has an undetectable viral load does not pass HIV to sexual partners. Regular viral load checks confirm it.' },
  { id: 'KB-013', category: 'treatment', audience: 'adult', language: 'en', status: 'approved', title: 'Missing a dose',
    text: 'If you miss a dose, follow the advice your clinic gave you. In general, take it as soon as you remember unless it is almost time for the next one, and do not double up. If you have missed several days, or you are unsure, contact your clinic or ask the assistant to connect you with a nurse.' },
  { id: 'KB-014', category: 'treatment', audience: 'adult', language: 'en', status: 'approved', title: 'Side effects alert',
    text: 'Some people have mild side effects when starting treatment, such as nausea, tiredness or headache, which often settle. Seek urgent care for a rash with fever or blistering, yellow eyes or skin, severe vomiting, or trouble breathing.' },
  { id: 'KB-015', category: 'prevention', audience: 'adult', language: 'en', status: 'approved', title: 'PrEP',
    text: 'PrEP is a medicine that people without HIV can take to greatly reduce their chance of getting HIV. It works best when taken exactly as prescribed. You need an HIV test and a health check first, and regular follow-up visits. Ask about PrEP if you are at ongoing risk of HIV, for example if a partner has HIV.' },
  { id: 'KB-016', category: 'prevention', audience: 'all', language: 'en', status: 'approved', title: 'PEP (urgent)',
    text: 'PEP is emergency medicine to reduce the chance of HIV after a possible exposure. It must be started as soon as possible and within 72 hours, and is taken for [CONFIRM: 28] days. If you think you were exposed, treat it as urgent and go to a TWC centre or hospital immediately. The assistant will connect you to a human.' },
  { id: 'KB-017', category: 'sti', audience: 'adult', language: 'en', status: 'approved', title: 'STI screening',
    text: 'Signs of an STI can include unusual discharge, burning when passing urine, genital sores or itching, or pain during sex, but many STIs have no symptoms. Screening is confidential, treatment is available, and partners may need treatment too.' },
  { id: 'KB-018', category: 'family_planning', audience: 'adult', language: 'en', status: 'approved', title: 'Family planning',
    text: 'TWC offers counselling on contraception including condoms, pills, injections, implants and other methods. A nurse helps you choose what suits your health and plans. Condoms also protect against HIV and STIs.' },
  { id: 'KB-019', category: 'tb', audience: 'all', language: 'en', status: 'approved', title: 'TB screening',
    text: 'See a nurse for TB screening if you have a cough for more than two weeks, fever, night sweats, unexplained weight loss, or tiredness. TB can be cured with treatment. People living with HIV are at higher risk of TB, so screening is routine.' },
  { id: 'KB-020', category: 'screening', audience: 'women', language: 'en', status: 'approved', title: 'Cervical screening',
    text: 'Cervical cancer screening finds changes early, when they are easier to treat. Women living with HIV are at higher risk and are usually advised to screen regularly. The visit is short. [CONFIRM screening interval policy]' },
  { id: 'KB-021', category: 'vmmc', audience: 'men', language: 'en', status: 'approved', title: 'Male circumcision',
    text: 'Voluntary medical male circumcision lowers a man\'s risk of getting HIV from female partners by around 60 percent. It is done by trained staff with counselling before and after. Healing takes a few weeks, and you must avoid sex until cleared by the clinic.' },
  { id: 'KB-022', category: 'mental_health', audience: 'all', language: 'en', status: 'approved', title: 'Mental wellness',
    text: 'Feeling stressed, low, anxious or unable to sleep is common and help is available. TWC counsellors offer confidential sessions and can refer you for further support. If you feel you may harm yourself, tell someone now and call emergency services.' },
  { id: 'KB-023', category: 'safety', audience: 'all', language: 'en', status: 'approved', title: 'After assault or abuse',
    text: 'If you have been sexually assaulted or abused, you are not to blame. Seek care as soon as possible. Medicine to prevent HIV (PEP) must be started within 72 hours. The assistant will offer to connect you to a TWC team member. Emergency contacts are in the emergency chunk.' },
  { id: 'KB-024', category: 'youth', audience: 'youth', language: 'en', status: 'approved', title: 'Youth-friendly services',
    text: 'Youth-friendly sessions are relaxed and confidential, with staff trained to talk with young people. Age rules for consent to testing and services follow Botswana policy. [CONFIRM age-of-consent rules before the assistant states any]' },
  { id: 'KB-025', category: 'pregnancy', audience: 'women', language: 'en', status: 'approved', title: 'Pregnancy and HIV',
    text: 'If you are pregnant, early antenatal care and an HIV test protect you and your baby. With treatment and follow-up, the chance of passing HIV to the baby can be very low. Talk to a nurse as soon as you know you are pregnant.' },
  { id: 'KB-026', category: 'outreach', audience: 'all', language: 'en', status: 'approved', title: 'Outreach and mobile clinics',
    text: 'TWC runs mobile clinics and community outreach for testing, family planning, self-test kits and health education. Dates change, so the assistant checks the live schedule rather than this text.' },
  { id: 'KB-027', category: 'healthy_living', audience: 'all', language: 'en', status: 'approved', title: 'Healthy living',
    text: 'Eating regularly, being active, limiting alcohol, sleeping well and having people to talk to all support health, including for people on treatment. Peer groups and counsellors can help with motivation and stigma.' },
  { id: 'KB-028', category: 'emergency', audience: 'all', language: 'en', status: 'approved', title: 'Emergency contacts',
    text: 'In an emergency go to the nearest hospital or call emergency services. Ambulance: 997 [VERIFY]. Police: 999 [VERIFY]. TWC human support line: [CONFIRM]. Chat help is not for emergencies.' },
  { id: 'KB-029', category: 'feedback', audience: 'all', language: 'en', status: 'approved', title: 'Feedback and complaints',
    text: 'We want to hear about your experience, good or bad. The assistant can record feedback and pass complaints to a TWC team member. You may stay anonymous. [CONFIRM complaints process and timeframes]' },
  { id: 'KB-030', category: 'documents', audience: 'all', language: 'en', status: 'approved', title: 'Uploading documents',
    text: 'You can upload a photo or scan of a referral letter, appointment card or form. The assistant reads the text, helps you act on it, and does not interpret medical findings. Uploaded files are deleted after [CONFIRM: 7] days.' },
  { id: 'KB-031', category: 'data_rights', audience: 'all', language: 'en', status: 'approved', title: 'Your data rights',
    text: 'You can ask to see, correct or delete the information TWC holds about you. The assistant will log the request and a TWC team member will follow up. [CONFIRM process and timeframe under Botswana\'s Data Protection Act]' },
  { id: 'KB-032', category: 'accessibility', audience: 'all', language: 'en', status: 'approved', title: 'Accessibility',
    text: 'Tell us about access needs when you book, for example wheelchair access, a hearing or vision need, or an interpreter. We will do our best to prepare. Availability varies by centre.' },
];
