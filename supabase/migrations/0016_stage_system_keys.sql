-- =============================================================================
-- 0016 — Étapes du pipeline : clés système
-- Les automatismes (visite « Intéressé »/« RDV »/« Vendu » → étape) ciblaient
-- l'étape PAR NOM, ce qui interdisait de renommer. `system_key` identifie ces
-- étapes de façon stable ; l'éditeur admin peut alors renommer librement.
-- =============================================================================

alter table pipeline_stages add column if not exists system_key text unique;

update pipeline_stages set system_key = 'interested' where name = 'Intéressé'      and system_key is null;
update pipeline_stages set system_key = 'rdv'        where name = 'RDV'            and system_key is null;
update pipeline_stages set system_key = 'won'        where is_won                  and system_key is null;
update pipeline_stages set system_key = 'lost'       where is_lost                 and system_key is null;
