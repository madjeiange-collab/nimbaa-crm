-- 0033 — Un chantier que personne n'a commencé peut être retiré.
--
-- installations avait select, insert et update, mais aucune politique de
-- suppression : un delete ne renvoyait pas d'erreur, il touchait simplement
-- zéro ligne. Découvert en annulant un essai avant toute pose — le chantier
-- prévu restait dans la file du technicien pour un matériel jamais sorti.
--
-- Même raisonnement qu'en 0029 pour les affaires : ce qui n'a rien produit
-- s'efface, ce qui porte une histoire reste. Un chantier « en cours » ou
-- « terminé », ou qui porte le moindre passage, n'est jamais supprimable —
-- pas même par un manager, parce que les photos et les durées qu'il porte
-- sont des preuves.
drop policy if exists installations_del on installations;
create policy installations_del on installations for delete
  using (
    auth.uid() is not null
    and status in ('pending', 'scheduled')
    and not exists (select 1 from visits v where v.installation_id = installations.id)
  );
