\set ON_ERROR_STOP on
BEGIN;
-- The first migration is kept compatible with existing installations.
ALTER TABLE :"studio_schema"._govern_dictation_segments
    DROP CONSTRAINT IF EXISTS _govern_dictation_segments_text_check;
ALTER TABLE :"studio_schema"._govern_dictation_segments
    ADD CONSTRAINT _govern_dictation_segments_text_check CHECK (octet_length(text)<=524288);
COMMIT;
