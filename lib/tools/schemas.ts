import { z } from 'zod';

// Zod schemas for every tool input. The executor validates before dispatch.
// These mirror the JSON schemas given to the LLM (lib/llm/tools.ts).

export const searchKnowledge = z.object({
  query: z.string().min(1).max(400),
  audience: z.enum(['general', 'youth', 'adults', 'pregnant', 'men', 'women']).optional(),
});

export const findSites = z.object({
  town: z.string().max(80).optional(),
  service_code: z.string().max(40).optional(),
  near: z.string().max(80).optional(),
});

export const listServices = z.object({
  site_code: z.string().max(40).optional(),
});

export const getAvailableSlots = z.object({
  site_code: z.string().min(1).max(40),
  service_code: z.string().min(1).max(40),
  date_from: z.string().max(30).optional(),
  date_to: z.string().max(30).optional(),
  part_of_day: z.enum(['morning', 'afternoon', 'any']).optional(),
});

export const getOutreachEvents = z.object({
  town: z.string().max(80).optional(),
  from: z.string().max(30).optional(),
  to: z.string().max(30).optional(),
});

export const getNotices = z.object({
  site_code: z.string().max(40).optional(),
});

export const startVerification = z.object({
  phone: z.string().min(6).max(20),
});

export const confirmVerification = z.object({
  code: z.string().min(3).max(10),
});

export const getMyAppointments = z.object({
  status: z.enum(['upcoming', 'past', 'cancelled', 'all']).optional(),
});

export const showAppointmentCalendar = z.object({
  site_code: z.string().max(40).optional(),
  service_code: z.string().max(40).optional(),
});

export const bookAppointment = z.object({
  slot_id: z.string().min(1).max(60),
  notes: z.string().max(300).optional(),
});

export const rescheduleAppointment = z.object({
  reference: z.string().min(3).max(40),
  new_slot_id: z.string().min(1).max(60),
});

export const cancelAppointment = z.object({
  reference: z.string().min(3).max(40),
});

export const getMyReferrals = z.object({});

export const updatePreferences = z.object({
  language: z.enum(['en', 'tn']).optional(),
  discreet_mode: z.boolean().optional(),
  consent_messaging: z.boolean().optional(),
  preferred_site: z.string().max(40).optional(),
});

export const requestDataAccessOrDeletion = z.object({
  type: z.enum(['access', 'deletion']),
});

export const processDocument = z.object({
  document_id: z.string().min(1).max(60),
});

export const escalateToHuman = z.object({
  reason: z.string().min(2).max(200),
  priority: z.enum(['low', 'normal', 'high', 'critical']),
  summary: z.string().min(2).max(600),
});

export const logFeedback = z.object({
  text: z.string().min(1).max(600),
  anonymous: z.boolean().optional(),
});

export const SCHEMAS = {
  search_knowledge: searchKnowledge,
  find_sites: findSites,
  list_services: listServices,
  get_available_slots: getAvailableSlots,
  get_outreach_events: getOutreachEvents,
  get_notices: getNotices,
  start_verification: startVerification,
  confirm_verification: confirmVerification,
  get_my_appointments: getMyAppointments,
  show_appointment_calendar: showAppointmentCalendar,
  book_appointment: bookAppointment,
  reschedule_appointment: rescheduleAppointment,
  cancel_appointment: cancelAppointment,
  get_my_referrals: getMyReferrals,
  update_preferences: updatePreferences,
  request_data_access_or_deletion: requestDataAccessOrDeletion,
  process_document: processDocument,
  escalate_to_human: escalateToHuman,
  log_feedback: logFeedback,
} as const;

export type ToolName = keyof typeof SCHEMAS;
