-- 0029 — Deleting an affaire is not an everyday gesture.
--
-- deals_del was `auth.uid() is not null`: anyone signed in could delete any
-- affaire on any customer. That is not a small loss. installations.deal_id
-- cascades, so the chantiers and their trips go with it, while the
-- subscription and the commission_entries survive with a dangling deal_id —
-- money records pointing at nothing.
--
-- A rep still needs to clear up an affaire typed by mistake, so the line is
-- drawn at whether anything has come of it: an 'open' affaire with no
-- subscription is disposable; anything won, lost, or already carrying a
-- subscription belongs to a manager.
drop policy if exists deals_del on deals;
create policy deals_del on deals
  for delete using (
    current_user_role() in ('manager', 'admin')
    or (
      status = 'open'
      and not exists (select 1 from subscriptions s where s.deal_id = deals.id)
    )
  );
