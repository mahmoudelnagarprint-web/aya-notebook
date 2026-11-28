-- Superseded: the canonical, idempotent schema lives at the repository root in
-- supabase/schema.sql (task domain + Aya + the public `uploads` Storage bucket).
--
-- Run that file in Supabase → SQL Editor. Keeping one source of truth avoids
-- applying two conflicting definitions of the aya_* tables.
select 'Apply supabase/schema.sql instead' as notice;
