-- ============================================================================
-- TWC AI Assistant - 0004 seed data (from docs/sample_data.txt Part 2B)
-- Idempotent: truncates the reference + demo tables then inserts.
-- ============================================================================
truncate reminders, appointments, referrals, clients, availability_slots,
  site_services, services, sites, notices, outreach_events restart identity cascade;

insert into sites (code,name,town,address,phone,hours,accessibility_notes) values
('GBE','TWC Gaborone','Gaborone','Plot 39, Unit 4, Gaborone International Commerce Park','+267 000 0001','{"mon_fri":"07:30-17:00","sat":"08:00-12:00","sun":null}','Step-free entrance; accessible toilet'),
('FRA','TWC Francistown','Francistown','[CONFIRM address]','+267 000 0002','{"mon_fri":"07:30-17:00","sat":"08:00-12:00","sun":null}','Step-free entrance'),
('MUN','TWC Maun','Maun','[CONFIRM address]','+267 000 0003','{"mon_fri":"07:30-16:30","sat":null,"sun":null}','Ramp at main door'),
('LOB','TWC Lobatse','Lobatse','[CONFIRM address]','+267 000 0004','{"mon_fri":"07:30-16:30","sat":"08:00-12:00","sun":null}',null),
('PAL','TWC Palapye','Palapye','[CONFIRM address]','+267 000 0005','{"mon_fri":"07:30-16:30","sat":null,"sun":null}',null),
('KAS','TWC Kasane','Kasane','[CONFIRM address]','+267 000 0006','{"mon_fri":"08:00-16:00","sat":null,"sun":null}',null);

insert into services (code,name,category,description,duration_min,walk_in_ok,requires_referral,min_age,youth_friendly,neutral_label) values
('HTC','HIV testing & counselling','prevention','Confidential rapid testing with pre- and post-test counselling',30,true,false,0,true,'Wellness check'),
('ART','Treatment follow-up & refills','treatment','Routine follow-up, adherence support and medication refills',20,true,false,0,true,'Wellness follow-up'),
('PREP','PrEP initiation & refills','prevention','HIV prevention medication assessment and follow-up',30,false,false,16,true,'Prevention consultation'),
('PEP','Post-exposure prophylaxis (urgent)','prevention','Urgent assessment after a possible HIV exposure',45,true,false,0,true,'Urgent consultation'),
('STI','STI screening & treatment','screening','Screening, treatment and partner guidance',30,true,false,0,true,'Wellness check'),
('FP','Family planning','wellness','Contraception counselling and methods',30,true,false,0,true,'Family planning visit'),
('TB','TB screening','screening','Symptom screening and referral for testing',20,true,false,0,true,'Chest health check'),
('CXCA','Cervical cancer screening','screening','Screening for cervical changes',30,false,false,18,false,'Women''s health screening'),
('VMMC','Male circumcision (VMMC)','prevention','Voluntary medical male circumcision with counselling',60,false,false,10,true,'Surgical consultation'),
('MH','Counselling & mental wellness','support','Individual counselling and referral for mental health support',45,false,false,0,true,'Counselling session'),
('GBV','Safe-space support','support','Confidential support after violence or abuse; links to medical care and PEP',45,true,false,0,true,'Support session'),
('YOUTH','Youth-friendly session','wellness','Relaxed sessions for adolescents and young adults',45,false,false,10,true,'Youth session'),
('SELFTEST','Self-test kit pickup','prevention','Collect an HIV self-test kit with instructions',10,true,false,16,true,'Health kit pickup');

with m(sc, vcs) as (values
 ('GBE', array['HTC','ART','PREP','PEP','STI','FP','TB','CXCA','VMMC','MH','GBV','YOUTH','SELFTEST']),
 ('FRA', array['HTC','ART','PREP','PEP','STI','FP','TB','CXCA','VMMC','MH','GBV','YOUTH','SELFTEST']),
 ('MUN', array['HTC','ART','PREP','STI','FP','TB','MH','SELFTEST']),
 ('LOB', array['HTC','ART','PREP','STI','FP','YOUTH','SELFTEST']),
 ('PAL', array['HTC','ART','STI','FP','TB','SELFTEST']),
 ('KAS', array['HTC','ART','PREP','STI','FP','SELFTEST']))
insert into site_services (site_id, service_id)
select s.id, v.id from m
join sites s on s.code = m.sc
cross join lateral unnest(m.vcs) u(vc)
join services v on v.code = u.vc;

insert into availability_slots (site_id, service_id, starts_at, ends_at, capacity)
select ss.site_id, ss.service_id,
       ((g.d::date + make_interval(hours => hh.h)) at time zone 'Africa/Gaborone'),
       ((g.d::date + make_interval(hours => hh.h, mins => sv.duration_min)) at time zone 'Africa/Gaborone'),
       2
from site_services ss
join services sv on sv.id = ss.service_id
cross join generate_series(current_date + 1, current_date + 14, interval '1 day') as g(d)
cross join generate_series(8, 15) as hh(h)
where extract(isodow from g.d) < 6
on conflict do nothing;

insert into clients (phone,first_name,birth_year,preferred_language,preferred_site_id,discreet_mode,consent_messaging,consent_at,verified_at) values
('+26771000001','Kefilwe',1991,'en',(select id from sites where code='GBE'),true,true,now(),now()),
('+26771000002','Thabo',1984,'tn',(select id from sites where code='FRA'),true,true,now(),now()),
('+26771000003','Neo',2007,'en',(select id from sites where code='GBE'),true,true,now(),now()),
('+26771000004','Mpho',1996,'en',(select id from sites where code='MUN'),true,true,now(),now()),
('+26771000005','Boitumelo',1978,'tn',(select id from sites where code='LOB'),true,false,null,now());

insert into appointments (reference,client_id,site_id,service_id,starts_at,status) values
('TWC-A-10231',(select id from clients where first_name='Kefilwe'),(select id from sites where code='GBE'),(select id from services where code='ART'),((current_date+2)+time '10:00') at time zone 'Africa/Gaborone','confirmed'),
('TWC-A-10232',(select id from clients where first_name='Thabo'),(select id from sites where code='FRA'),(select id from services where code='FP'),((current_date+3)+time '09:00') at time zone 'Africa/Gaborone','booked'),
('TWC-A-10233',(select id from clients where first_name='Neo'),(select id from sites where code='GBE'),(select id from services where code='YOUTH'),((current_date+5)+time '14:00') at time zone 'Africa/Gaborone','booked'),
('TWC-A-10234',(select id from clients where first_name='Mpho'),(select id from sites where code='MUN'),(select id from services where code='TB'),((current_date-6)+time '11:00') at time zone 'Africa/Gaborone','completed'),
('TWC-A-10235',(select id from clients where first_name='Kefilwe'),(select id from sites where code='GBE'),(select id from services where code='CXCA'),((current_date-30)+time '08:00') at time zone 'Africa/Gaborone','completed'),
('TWC-A-10236',(select id from clients where first_name='Boitumelo'),(select id from sites where code='LOB'),(select id from services where code='ART'),((current_date-2)+time '10:00') at time zone 'Africa/Gaborone','no_show');

insert into referrals (reference,client_id,from_site_id,to_facility,to_service,status,due_by,what_to_bring) values
('TWC-R-5521',(select id from clients where first_name='Kefilwe'),(select id from sites where code='GBE'),'Princess Marina Hospital (Outpatients) [CONFIRM]','Specialist review','issued',current_date+10,'Omang, referral letter, appointment card'),
('TWC-R-5522',(select id from clients where first_name='Mpho'),(select id from sites where code='MUN'),'Letsholathebe II Memorial Hospital [CONFIRM]','Chest X-ray','acknowledged',current_date+4,'Omang, referral letter'),
('TWC-R-5523',(select id from clients where first_name='Thabo'),(select id from sites where code='FRA'),'Nyangabgwe Referral Hospital [CONFIRM]','Imaging','attended',null,'Omang'),
('TWC-R-5524',(select id from clients where first_name='Boitumelo'),(select id from sites where code='LOB'),'Local clinic [CONFIRM]','Follow-up review','lost_to_followup',current_date-5,'Omang, card');

insert into reminders (client_id,appointment_id,type,send_at,status)
select a.client_id, a.id, 'appointment', a.starts_at - interval '24 hours', 'scheduled'
from appointments a where a.status in ('booked','confirmed') and a.starts_at > now();

insert into notices (site_id,title,body,ends_at) values
((select id from sites where code='MUN'),'Reduced hours this Friday','TWC Maun closes at 13:00 this Friday for staff training. Walk-ins before 12:30 are welcome.',now()+interval '7 days'),
(null,'Extended hours for testing','Selected centres run testing until 18:00 on Thursdays this month [CONFIRM].',now()+interval '30 days');

insert into outreach_events (title,town,venue,starts_at,ends_at,service_codes,notes) values
('Mobile clinic','Mogoditshane','Community hall [CONFIRM]',((current_date+4)+time '09:00') at time zone 'Africa/Gaborone',((current_date+4)+time '15:00') at time zone 'Africa/Gaborone',array['HTC','FP','SELFTEST','STI'],'Walk-ins welcome'),
('Youth wellness day','Old Naledi, Gaborone','Youth centre [CONFIRM]',((current_date+9)+time '10:00') at time zone 'Africa/Gaborone',((current_date+9)+time '14:00') at time zone 'Africa/Gaborone',array['YOUTH','HTC','MH'],'Ages 15-24'),
('Campus health week','Gaborone','University campus [CONFIRM]',((current_date+12)+time '09:00') at time zone 'Africa/Gaborone',((current_date+12)+time '16:00') at time zone 'Africa/Gaborone',array['HTC','SELFTEST','STI','FP'],'Student ID not required');

-- KB governance rows (one per approved chunk). status drives retrieval filter.
insert into kb_sources (id,title,owner,approved_by,version,status) values
('KB-001','About TWC','Comms','Demo', '1.0','approved'),
('KB-002','Services overview','Programmes','Demo','1.0','approved'),
('KB-008','How HIV testing works','Clinical','Demo','1.0','approved'),
('KB-016','PEP (urgent)','Clinical','Demo','1.0','approved'),
('KB-024','Youth-friendly services','Youth','Demo','1.0','approved'),
('KB-028','Emergency contacts','Clinical','Demo','1.0','approved')
on conflict (id) do nothing;
