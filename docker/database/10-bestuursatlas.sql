-- BESTUURSATLAS VOOR PHPMYADMIN — versie 2.0 — 28 oktober 2026.
-- Selecteer eerst een LEGE database in phpMyAdmin en importeer dit SQL-bestand.
-- Doel: MySQL >= 8.0.16 of MariaDB >= 10.6, met InnoDB en CHECK-handhaving.
-- Maakt 23 tabellen en 3 views en voegt 96 brononderbouwde voorbeeldrecords toe.
-- Geen CREATE DATABASE, vaste USE, DROP, gebruikersaccounts of externe verbindingen.
-- Eenmalige installatie. Importeer dit totaalbestand niet opnieuw over bestaande tabellen.
-- DDL doet impliciete commits: bij een fout kan een deel van de installatie al bestaan.
-- Stop bij een fout. Gebruik een nieuwe lege database voordat je de hele import herhaalt.
-- audit_log blijft leeg tot optionele installatie van 04_audit_optie.sql.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+00:00';
SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ZERO_DATE,NO_ZERO_IN_DATE,ONLY_FULL_GROUP_BY';
SET FOREIGN_KEY_CHECKS = 1;

-- Compatibiliteitscontrole: voorkomt stille acceptatie van CHECK op oud MySQL.
SET @bestuursatlas_version_major = CAST(SUBSTRING_INDEX(VERSION(), '.', 1) AS UNSIGNED);
SET @bestuursatlas_version_minor = CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(VERSION(), '.', 2), '.', -1) AS UNSIGNED);
SET @bestuursatlas_version_patch = CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(VERSION(), '.', 3), '.', -1), '-', 1) AS UNSIGNED);
SET @bestuursatlas_version_number = @bestuursatlas_version_major * 10000 + @bestuursatlas_version_minor * 100 + @bestuursatlas_version_patch;
SET @bestuursatlas_supported = IF(LOCATE('MariaDB', VERSION()) > 0, @bestuursatlas_version_number >= 100600, @bestuursatlas_version_number >= 80016);
SET @bestuursatlas_version_sql = IF(@bestuursatlas_supported,
  'SELECT ''Serverversie geschikt voor Bestuursatlas'' AS installatiecontrole',
  'SELECT `BESTUURSATLAS_VEREIST_MYSQL_8_0_16_OF_MARIADB_10_6_OF_NIEUWER`');
PREPARE bestuursatlas_version_check FROM @bestuursatlas_version_sql;
EXECUTE bestuursatlas_version_check;
DEALLOCATE PREPARE bestuursatlas_version_check;
SET @bestuursatlas_version_major = NULL, @bestuursatlas_version_minor = NULL,
    @bestuursatlas_version_patch = NULL, @bestuursatlas_version_number = NULL,
    @bestuursatlas_supported = NULL, @bestuursatlas_version_sql = NULL;


-- ONDERDEEL: 01_schema.sql

-- Bestuursatlas: MySQL 8.0.16+/8.4 en MariaDB 10.6+.
-- Importeer eenmaal in de database die je zelf in phpMyAdmin hebt geselecteerd.
-- Dit bestand maakt 23 tabellen. Het kiest of verwijdert geen database.
-- DDL veroorzaakt impliciete commits; een gedeeltelijke import rolt niet als geheel terug.
-- Werk daarom in een lege database en stop bij de eerste foutmelding.
-- JSON bevat uitsluitend auditwaarden; de domeingegevens blijven relationeel.
-- CHECK-handhaving is vereist. MySQL 5.7 en MySQL 8.0 voor 8.0.16 zijn ongeschikt.
-- De UTC-tijdzone is een verbindingsafspraak: stel deze ook in applicatieverbindingen in.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+00:00';
SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ZERO_DATE,NO_ZERO_IN_DATE,ONLY_FULL_GROUP_BY';
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE `sources` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `title` TEXT NOT NULL,
    `publisher` TEXT NOT NULL,
    `url` TEXT NOT NULL,
    `source_kind` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `publication_date` DATE,
    `retrieved_on` DATE NOT NULL,
    `notes` TEXT,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    CONSTRAINT `ck_sources_1` CHECK (code REGEXP '^[a-z][a-z0-9_]*$' AND code NOT REGEXP '[^a-z0-9_]'),
    UNIQUE KEY `sources_code_uq` (`code`),
    CONSTRAINT `ck_sources_2` CHECK (TRIM(title) <> ''),
    CONSTRAINT `ck_sources_3` CHECK (TRIM(publisher) <> ''),
    CONSTRAINT `ck_sources_4` CHECK (url REGEXP '^https?://'),
    CONSTRAINT `ck_sources_5` CHECK (source_kind IN ('documentation','report','law','archive','website','other'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Bronmetadata; een URL bewijst op zichzelf niet dat een bewering juist is.';

CREATE TABLE `evidence` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `statement` TEXT NOT NULL,
    `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'draft',
    `assessment_date` DATE NOT NULL,
    `assessment_note` TEXT,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    CONSTRAINT `ck_evidence_1` CHECK (code REGEXP '^[a-z][a-z0-9_]*$' AND code NOT REGEXP '[^a-z0-9_]'),
    UNIQUE KEY `evidence_code_uq` (`code`),
    CONSTRAINT `ck_evidence_2` CHECK (TRIM(statement) <> ''),
    CONSTRAINT `ck_evidence_3` CHECK (status IN ('draft','reviewed','published','disputed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Afzonderlijke bewering en redactionele beoordeling; status is geen automatische waarheidsverklaring.';

CREATE TABLE `evidence_sources` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `evidence_id` BIGINT NOT NULL,
    `source_id` BIGINT NOT NULL,
    `claim_locator` VARCHAR(500) NOT NULL COMMENT 'Concrete vindplaats, bijvoorbeeld hoofdstuk, paragraaf, paginanummer of herkenbare passage.',
    `relation_kind` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'supports',
    `support_note` TEXT,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    CONSTRAINT `ck_evidence_sources_1` CHECK (code REGEXP '^[a-z][a-z0-9_]*$' AND code NOT REGEXP '[^a-z0-9_]'),
    UNIQUE KEY `evidence_sources_code_uq` (`code`),
    CONSTRAINT `ck_evidence_sources_2` CHECK (TRIM(claim_locator) <> ''),
    CONSTRAINT `ck_evidence_sources_3` CHECK (relation_kind IN ('supports','qualifies','contradicts')),
    UNIQUE (evidence_id, source_id, claim_locator),
    KEY `evidence_sources_source_idx` (`source_id`),
    CONSTRAINT `fk_evidence_sources_evidence_id` FOREIGN KEY (`evidence_id`) REFERENCES `evidence` (`id`),
    CONSTRAINT `fk_evidence_sources_source_id` FOREIGN KEY (`source_id`) REFERENCES `sources` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Verbindt een concrete bewering met een specifieke passage, inclusief tegensprekende bronnen.';

CREATE TABLE `organizations` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NOT NULL,
    `organization_kind` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `evidence_id` BIGINT NOT NULL,
    `observed_on` DATE NOT NULL COMMENT 'Datum waarop de beschrijving is waargenomen; geen vervanging voor een ingangsdatum.',
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    CONSTRAINT `ck_organizations_1` CHECK (code REGEXP '^[a-z][a-z0-9_]*$' AND code NOT REGEXP '[^a-z0-9_]'),
    UNIQUE KEY `organizations_code_uq` (`code`),
    CONSTRAINT `ck_organizations_2` CHECK (TRIM(name) <> ''),
    CONSTRAINT `ck_organizations_3` CHECK (TRIM(description) <> ''),
    CONSTRAINT `ck_organizations_4` CHECK (organization_kind IN ('ministry','municipality','province','water_authority','agency','collaboration','parliament','other_public_body','private_organization','other')),
    KEY `organizations_evidence_idx` (`evidence_id`),
    CONSTRAINT `fk_organizations_evidence_id` FOREIGN KEY (`evidence_id`) REFERENCES `evidence` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Organisaties; de naam of bestuurlijke inbedding verleent geen automatisch mandaat.';

CREATE TABLE `territories` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NOT NULL,
    `territory_kind` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `evidence_id` BIGINT NOT NULL,
    `observed_on` DATE NOT NULL COMMENT 'Datum waarop de beschrijving is waargenomen; geen vervanging voor een ingangsdatum.',
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    CONSTRAINT `ck_territories_1` CHECK (code REGEXP '^[a-z][a-z0-9_]*$' AND code NOT REGEXP '[^a-z0-9_]'),
    UNIQUE KEY `territories_code_uq` (`code`),
    CONSTRAINT `ck_territories_2` CHECK (TRIM(name) <> ''),
    CONSTRAINT `ck_territories_3` CHECK (TRIM(description) <> ''),
    CONSTRAINT `ck_territories_4` CHECK (territory_kind IN ('country','province','municipality','water_district','region','other')),
    KEY `territories_evidence_idx` (`evidence_id`),
    CONSTRAINT `fk_territories_evidence_id` FOREIGN KEY (`evidence_id`) REFERENCES `evidence` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Beschreven werkingsgebieden; bevat in deze versie geen geometrie of grenshistorie.';

CREATE TABLE `public_functions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NOT NULL,
    `function_kind` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `parent_function_id` BIGINT,
    `evidence_id` BIGINT NOT NULL,
    `observed_on` DATE NOT NULL COMMENT 'Datum waarop de beschrijving is waargenomen; geen vervanging voor een ingangsdatum.',
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    CONSTRAINT `ck_public_functions_1` CHECK (code REGEXP '^[a-z][a-z0-9_]*$' AND code NOT REGEXP '[^a-z0-9_]'),
    UNIQUE KEY `public_functions_code_uq` (`code`),
    CONSTRAINT `ck_public_functions_2` CHECK (TRIM(name) <> ''),
    CONSTRAINT `ck_public_functions_3` CHECK (TRIM(description) <> ''),
    CONSTRAINT `ck_public_functions_4` CHECK (function_kind IN ('task','service')),
    KEY `public_functions_parent_idx` (`parent_function_id`),
    KEY `public_functions_evidence_idx` (`evidence_id`),
    CONSTRAINT `fk_public_functions_parent_function_id` FOREIGN KEY (`parent_function_id`) REFERENCES `public_functions` (`id`),
    CONSTRAINT `fk_public_functions_evidence_id` FOREIGN KEY (`evidence_id`) REFERENCES `evidence` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Taken en diensten met een expliciet type; inhoudelijke groepering is geen bevoegdheidsbesluit. Directe zelfkoppeling: kwaliteitsview; optionele triggers blokkeren dit.';

CREATE TABLE `digital_systems` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NOT NULL,
    `system_kind` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `lifecycle_status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Beschreven operationele toestand op observed_on; niet de publicatiestatus van de bewering.',
    `evidence_id` BIGINT NOT NULL,
    `observed_on` DATE NOT NULL COMMENT 'Datum waarop de beschrijving is waargenomen; geen vervanging voor een ingangsdatum.',
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    CONSTRAINT `ck_digital_systems_1` CHECK (code REGEXP '^[a-z][a-z0-9_]*$' AND code NOT REGEXP '[^a-z0-9_]'),
    UNIQUE KEY `digital_systems_code_uq` (`code`),
    CONSTRAINT `ck_digital_systems_2` CHECK (TRIM(name) <> ''),
    CONSTRAINT `ck_digital_systems_3` CHECK (TRIM(description) <> ''),
    CONSTRAINT `ck_digital_systems_4` CHECK (system_kind IN ('authentication','portal','exchange','network','case_management','registry_service','other')),
    CONSTRAINT `ck_digital_systems_5` CHECK (lifecycle_status IN ('planned','pilot','operational','retired')),
    KEY `digital_systems_evidence_idx` (`evidence_id`),
    CONSTRAINT `fk_digital_systems_evidence_id` FOREIGN KEY (`evidence_id`) REFERENCES `evidence` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Digitale voorzieningen en toepassingen, afzonderlijk van hun gegevens en moderniseringsprojecten.';

CREATE TABLE `datasets` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NOT NULL,
    `dataset_kind` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `access_classification` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'unknown',
    `lifecycle_status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `evidence_id` BIGINT NOT NULL,
    `observed_on` DATE NOT NULL COMMENT 'Datum waarop de beschrijving is waargenomen; geen vervanging voor een ingangsdatum.',
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    CONSTRAINT `ck_datasets_1` CHECK (code REGEXP '^[a-z][a-z0-9_]*$' AND code NOT REGEXP '[^a-z0-9_]'),
    UNIQUE KEY `datasets_code_uq` (`code`),
    CONSTRAINT `ck_datasets_2` CHECK (TRIM(name) <> ''),
    CONSTRAINT `ck_datasets_3` CHECK (TRIM(description) <> ''),
    CONSTRAINT `ck_datasets_4` CHECK (dataset_kind IN ('base_register','statistics','geospatial','administrative','other')),
    CONSTRAINT `ck_datasets_5` CHECK (access_classification IN ('open','restricted','mixed','unknown')),
    CONSTRAINT `ck_datasets_6` CHECK (lifecycle_status IN ('planned','pilot','operational','retired')),
    KEY `datasets_evidence_idx` (`evidence_id`),
    CONSTRAINT `fk_datasets_evidence_id` FOREIGN KEY (`evidence_id`) REFERENCES `evidence` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Metadata over registraties en gegevensverzamelingen; de feitelijke inhoud wordt hier niet opgeslagen.';

CREATE TABLE `technologies` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NOT NULL,
    `technology_kind` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `evidence_id` BIGINT NOT NULL,
    `observed_on` DATE NOT NULL COMMENT 'Datum waarop de beschrijving is waargenomen; geen vervanging voor een ingangsdatum.',
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    CONSTRAINT `ck_technologies_1` CHECK (code REGEXP '^[a-z][a-z0-9_]*$' AND code NOT REGEXP '[^a-z0-9_]'),
    UNIQUE KEY `technologies_code_uq` (`code`),
    CONSTRAINT `ck_technologies_2` CHECK (TRIM(name) <> ''),
    CONSTRAINT `ck_technologies_3` CHECK (TRIM(description) <> ''),
    CONSTRAINT `ck_technologies_4` CHECK (technology_kind IN ('hardware','software','protocol','data_format','standard','architecture','other')),
    KEY `technologies_evidence_idx` (`evidence_id`),
    CONSTRAINT `fk_technologies_evidence_id` FOREIGN KEY (`evidence_id`) REFERENCES `evidence` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Technologieën en standaarden; hun beschikbaarheid bewijst geen gebruik door een bepaald systeem.';

CREATE TABLE `programmes` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NOT NULL,
    `programme_kind` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `lifecycle_status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `evidence_id` BIGINT NOT NULL,
    `observed_on` DATE NOT NULL COMMENT 'Datum waarop de beschrijving is waargenomen; geen vervanging voor een ingangsdatum.',
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    CONSTRAINT `ck_programmes_1` CHECK (code REGEXP '^[a-z][a-z0-9_]*$' AND code NOT REGEXP '[^a-z0-9_]'),
    UNIQUE KEY `programmes_code_uq` (`code`),
    CONSTRAINT `ck_programmes_2` CHECK (TRIM(name) <> ''),
    CONSTRAINT `ck_programmes_3` CHECK (TRIM(description) <> ''),
    CONSTRAINT `ck_programmes_4` CHECK (programme_kind IN ('programme','project','policy')),
    CONSTRAINT `ck_programmes_5` CHECK (lifecycle_status IN ('planned','active','completed','stopped')),
    KEY `programmes_evidence_idx` (`evidence_id`),
    CONSTRAINT `fk_programmes_evidence_id` FOREIGN KEY (`evidence_id`) REFERENCES `evidence` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Veranderprojecten en programma’s; een gestopt project beëindigt niet automatisch het betrokken systeem.';

CREATE TABLE `historical_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `title` TEXT NOT NULL,
    `description` TEXT NOT NULL,
    `event_kind` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `earliest_date` DATE COMMENT 'Vroegst mogelijke datum van de gebeurtenis, inclusief; NULL bij volledig onbekende datering.',
    `latest_date` DATE COMMENT 'Laatst mogelijke datum van de gebeurtenis, inclusief; dit is geen exclusieve geldigheidseinddatum.',
    `date_precision` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'SQL controleert aanwezigheid, volgorde en exact_day; aansluiting van maand, jaar en decennium op het datumvenster vereist redactionele controle.',
    `date_label` TEXT NOT NULL,
    `evidence_id` BIGINT NOT NULL,
    `observed_on` DATE NOT NULL COMMENT 'Datum waarop de beschrijving is waargenomen; geen vervanging voor een ingangsdatum.',
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    CONSTRAINT `ck_historical_events_1` CHECK (code REGEXP '^[a-z][a-z0-9_]*$' AND code NOT REGEXP '[^a-z0-9_]'),
    UNIQUE KEY `historical_events_code_uq` (`code`),
    CONSTRAINT `ck_historical_events_2` CHECK (TRIM(title) <> ''),
    CONSTRAINT `ck_historical_events_3` CHECK (TRIM(description) <> ''),
    CONSTRAINT `ck_historical_events_4` CHECK (event_kind IN ('establishment','launch','change','termination','publication','incident','other')),
    CONSTRAINT `ck_historical_events_5` CHECK (date_precision IN ('exact_day','month','year','decade','range','unknown')),
    CONSTRAINT `ck_historical_events_6` CHECK (TRIM(date_label) <> ''),
    CONSTRAINT `ck_historical_events_7` CHECK ((date_precision = 'unknown' AND earliest_date IS NULL AND latest_date IS NULL)
        OR (date_precision <> 'unknown' AND earliest_date IS NOT NULL AND latest_date IS NOT NULL AND earliest_date <= latest_date)),
    CONSTRAINT `ck_historical_events_8` CHECK (date_precision <> 'exact_day' OR earliest_date = latest_date),
    KEY `historical_events_evidence_idx` (`evidence_id`),
    KEY `historical_events_date_idx` (`earliest_date`,`latest_date`),
    CONSTRAINT `fk_historical_events_evidence_id` FOREIGN KEY (`evidence_id`) REFERENCES `evidence` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Mijlpalen met expliciete datumprecisie; het datumvenster beschrijft onzekerheid, geen operationele looptijd.';

CREATE TABLE `organization_relations` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `from_organization_id` BIGINT NOT NULL,
    `to_organization_id` BIGINT NOT NULL,
    `relation_kind` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `notes` TEXT,
    `evidence_id` BIGINT NOT NULL,
    `valid_from` DATE COMMENT 'Bekende ingangsdatum inclusief; NULL betekent onbekend.',
    `valid_until` DATE COMMENT 'Bekende einddatum exclusief; NULL betekent onbekend, niet onbeperkt geldig.',
    `observed_on` DATE NOT NULL COMMENT 'Datum waarop de beschrijving is waargenomen; geen vervanging voor een ingangsdatum.',
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `relation_date_kind` TINYINT GENERATED ALWAYS AS (valid_from IS NULL) STORED COMMENT '0: bekende start; 1: onbekende start met observatiedatum. Alleen voor unieke index.',
    `relation_date` DATE GENERATED ALWAYS AS (COALESCE(valid_from, observed_on)) STORED COMMENT 'Indexdatum; bij onbekende start blijft valid_from NULL en wordt observed_on gebruikt.',
    CONSTRAINT `ck_organization_relations_1` CHECK (code REGEXP '^[a-z][a-z0-9_]*$' AND code NOT REGEXP '[^a-z0-9_]'),
    UNIQUE KEY `organization_relations_code_uq` (`code`),
    CONSTRAINT `ck_organization_relations_2` CHECK (relation_kind IN ('administrative_part_of','collaborates_with','supervises','succeeds','other')),
    CONSTRAINT `ck_organization_relations_3` CHECK (from_organization_id <> to_organization_id),
    CONSTRAINT `ck_organization_relations_4` CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until),
    UNIQUE KEY `organization_relations_relation_date_uq` (`from_organization_id`,`to_organization_id`,`relation_kind`,`relation_date_kind`,`relation_date`),
    KEY `organization_relations_to_idx` (`to_organization_id`),
    KEY `organization_relations_evidence_idx` (`evidence_id`),
    KEY `organization_relations_from_idx` (`from_organization_id`),
    CONSTRAINT `fk_organization_relations_from_organization_id` FOREIGN KEY (`from_organization_id`) REFERENCES `organizations` (`id`),
    CONSTRAINT `fk_organization_relations_to_organization_id` FOREIGN KEY (`to_organization_id`) REFERENCES `organizations` (`id`),
    CONSTRAINT `fk_organization_relations_evidence_id` FOREIGN KEY (`evidence_id`) REFERENCES `evidence` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Getypeerde organisatierelaties; administrative_part_of loopt van onderdeel naar bovenliggende organisatie en impliceert geen mandaat.';

CREATE TABLE `mandates` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `organization_id` BIGINT NOT NULL,
    `public_function_id` BIGINT NOT NULL,
    `territory_id` BIGINT NOT NULL,
    `mandate_kind` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'responsible_for',
    `legal_basis_note` TEXT,
    `evidence_id` BIGINT NOT NULL,
    `valid_from` DATE COMMENT 'Bekende ingangsdatum inclusief; NULL betekent onbekend.',
    `valid_until` DATE COMMENT 'Bekende einddatum exclusief; NULL betekent onbekend, niet onbeperkt geldig.',
    `observed_on` DATE NOT NULL COMMENT 'Datum waarop de beschrijving is waargenomen; geen vervanging voor een ingangsdatum.',
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `relation_date_kind` TINYINT GENERATED ALWAYS AS (valid_from IS NULL) STORED COMMENT '0: bekende start; 1: onbekende start met observatiedatum. Alleen voor unieke index.',
    `relation_date` DATE GENERATED ALWAYS AS (COALESCE(valid_from, observed_on)) STORED COMMENT 'Indexdatum; bij onbekende start blijft valid_from NULL en wordt observed_on gebruikt.',
    CONSTRAINT `ck_mandates_1` CHECK (code REGEXP '^[a-z][a-z0-9_]*$' AND code NOT REGEXP '[^a-z0-9_]'),
    UNIQUE KEY `mandates_code_uq` (`code`),
    CONSTRAINT `ck_mandates_2` CHECK (mandate_kind IN ('responsible_for','delivers','advises_on','oversees')),
    CONSTRAINT `ck_mandates_3` CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until),
    UNIQUE KEY `mandates_relation_date_uq` (`organization_id`,`public_function_id`,`territory_id`,`mandate_kind`,`relation_date_kind`,`relation_date`),
    KEY `mandates_function_idx` (`public_function_id`),
    KEY `mandates_territory_idx` (`territory_id`),
    KEY `mandates_evidence_idx` (`evidence_id`),
    KEY `mandates_organization_idx` (`organization_id`),
    CONSTRAINT `fk_mandates_organization_id` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
    CONSTRAINT `fk_mandates_public_function_id` FOREIGN KEY (`public_function_id`) REFERENCES `public_functions` (`id`),
    CONSTRAINT `fk_mandates_territory_id` FOREIGN KEY (`territory_id`) REFERENCES `territories` (`id`),
    CONSTRAINT `fk_mandates_evidence_id` FOREIGN KEY (`evidence_id`) REFERENCES `evidence` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Onderbouwde toedeling van een taak of dienst aan een organisatie en werkingsgebied; geen technische toegangstoestemming.';

CREATE TABLE `system_responsibilities` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `organization_id` BIGINT NOT NULL,
    `system_id` BIGINT NOT NULL,
    `responsibility_role` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `notes` TEXT,
    `evidence_id` BIGINT NOT NULL,
    `valid_from` DATE COMMENT 'Bekende ingangsdatum inclusief; NULL betekent onbekend.',
    `valid_until` DATE COMMENT 'Bekende einddatum exclusief; NULL betekent onbekend, niet onbeperkt geldig.',
    `observed_on` DATE NOT NULL COMMENT 'Datum waarop de beschrijving is waargenomen; geen vervanging voor een ingangsdatum.',
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `relation_date_kind` TINYINT GENERATED ALWAYS AS (valid_from IS NULL) STORED COMMENT '0: bekende start; 1: onbekende start met observatiedatum. Alleen voor unieke index.',
    `relation_date` DATE GENERATED ALWAYS AS (COALESCE(valid_from, observed_on)) STORED COMMENT 'Indexdatum; bij onbekende start blijft valid_from NULL en wordt observed_on gebruikt.',
    CONSTRAINT `ck_system_responsibilities_1` CHECK (code REGEXP '^[a-z][a-z0-9_]*$' AND code NOT REGEXP '[^a-z0-9_]'),
    UNIQUE KEY `system_responsibilities_code_uq` (`code`),
    CONSTRAINT `ck_system_responsibilities_2` CHECK (responsibility_role IN ('owner','commissioner','operator','technical_manager','service_manager','regulator','provider','other')),
    CONSTRAINT `ck_system_responsibilities_3` CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until),
    UNIQUE KEY `system_responsibilities_relation_date_uq` (`organization_id`,`system_id`,`responsibility_role`,`relation_date_kind`,`relation_date`),
    KEY `system_responsibilities_system_idx` (`system_id`),
    KEY `system_responsibilities_evidence_idx` (`evidence_id`),
    KEY `system_responsibilities_organization_idx` (`organization_id`),
    CONSTRAINT `fk_system_responsibilities_organization_id` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
    CONSTRAINT `fk_system_responsibilities_system_id` FOREIGN KEY (`system_id`) REFERENCES `digital_systems` (`id`),
    CONSTRAINT `fk_system_responsibilities_evidence_id` FOREIGN KEY (`evidence_id`) REFERENCES `evidence` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Expliciete systeemrollen; beheer, opdrachtgeverschap en eigendom worden niet gelijkgesteld.';

CREATE TABLE `dataset_responsibilities` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `organization_id` BIGINT NOT NULL,
    `dataset_id` BIGINT NOT NULL,
    `responsibility_role` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `notes` TEXT,
    `evidence_id` BIGINT NOT NULL,
    `valid_from` DATE COMMENT 'Bekende ingangsdatum inclusief; NULL betekent onbekend.',
    `valid_until` DATE COMMENT 'Bekende einddatum exclusief; NULL betekent onbekend, niet onbeperkt geldig.',
    `observed_on` DATE NOT NULL COMMENT 'Datum waarop de beschrijving is waargenomen; geen vervanging voor een ingangsdatum.',
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `relation_date_kind` TINYINT GENERATED ALWAYS AS (valid_from IS NULL) STORED COMMENT '0: bekende start; 1: onbekende start met observatiedatum. Alleen voor unieke index.',
    `relation_date` DATE GENERATED ALWAYS AS (COALESCE(valid_from, observed_on)) STORED COMMENT 'Indexdatum; bij onbekende start blijft valid_from NULL en wordt observed_on gebruikt.',
    CONSTRAINT `ck_dataset_responsibilities_1` CHECK (code REGEXP '^[a-z][a-z0-9_]*$' AND code NOT REGEXP '[^a-z0-9_]'),
    UNIQUE KEY `dataset_responsibilities_code_uq` (`code`),
    CONSTRAINT `ck_dataset_responsibilities_2` CHECK (responsibility_role IN ('source_holder','register_manager','distributor','custodian','other')),
    CONSTRAINT `ck_dataset_responsibilities_3` CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until),
    UNIQUE KEY `dataset_responsibilities_relation_date_uq` (`organization_id`,`dataset_id`,`responsibility_role`,`relation_date_kind`,`relation_date`),
    KEY `dataset_responsibilities_dataset_idx` (`dataset_id`),
    KEY `dataset_responsibilities_evidence_idx` (`evidence_id`),
    KEY `dataset_responsibilities_organization_idx` (`organization_id`),
    CONSTRAINT `fk_dataset_responsibilities_organization_id` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
    CONSTRAINT `fk_dataset_responsibilities_dataset_id` FOREIGN KEY (`dataset_id`) REFERENCES `datasets` (`id`),
    CONSTRAINT `fk_dataset_responsibilities_evidence_id` FOREIGN KEY (`evidence_id`) REFERENCES `evidence` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Rollen bij gegevens, afzonderlijk van rollen bij de gebruikte software.';

CREATE TABLE `system_dataset_usage` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `system_id` BIGINT NOT NULL,
    `dataset_id` BIGINT NOT NULL,
    `usage_role` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `notes` TEXT,
    `evidence_id` BIGINT NOT NULL,
    `valid_from` DATE COMMENT 'Bekende ingangsdatum inclusief; NULL betekent onbekend.',
    `valid_until` DATE COMMENT 'Bekende einddatum exclusief; NULL betekent onbekend, niet onbeperkt geldig.',
    `observed_on` DATE NOT NULL COMMENT 'Datum waarop de beschrijving is waargenomen; geen vervanging voor een ingangsdatum.',
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `relation_date_kind` TINYINT GENERATED ALWAYS AS (valid_from IS NULL) STORED COMMENT '0: bekende start; 1: onbekende start met observatiedatum. Alleen voor unieke index.',
    `relation_date` DATE GENERATED ALWAYS AS (COALESCE(valid_from, observed_on)) STORED COMMENT 'Indexdatum; bij onbekende start blijft valid_from NULL en wordt observed_on gebruikt.',
    CONSTRAINT `ck_system_dataset_usage_1` CHECK (code REGEXP '^[a-z][a-z0-9_]*$' AND code NOT REGEXP '[^a-z0-9_]'),
    UNIQUE KEY `system_dataset_usage_code_uq` (`code`),
    CONSTRAINT `ck_system_dataset_usage_2` CHECK (usage_role IN ('reads','writes','stores','serves','other')),
    CONSTRAINT `ck_system_dataset_usage_3` CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until),
    UNIQUE KEY `system_dataset_usage_relation_date_uq` (`system_id`,`dataset_id`,`usage_role`,`relation_date_kind`,`relation_date`),
    KEY `system_dataset_usage_dataset_idx` (`dataset_id`),
    KEY `system_dataset_usage_evidence_idx` (`evidence_id`),
    KEY `system_dataset_usage_system_idx` (`system_id`),
    CONSTRAINT `fk_system_dataset_usage_system_id` FOREIGN KEY (`system_id`) REFERENCES `digital_systems` (`id`),
    CONSTRAINT `fk_system_dataset_usage_dataset_id` FOREIGN KEY (`dataset_id`) REFERENCES `datasets` (`id`),
    CONSTRAINT `fk_system_dataset_usage_evidence_id` FOREIGN KEY (`evidence_id`) REFERENCES `evidence` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Onderbouwd gebruik van een gegevensverzameling door een systeem; geen inhoudelijke burgergegevens.';

CREATE TABLE `system_technologies` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `system_id` BIGINT NOT NULL,
    `technology_id` BIGINT NOT NULL,
    `usage_role` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'uses',
    `notes` TEXT,
    `evidence_id` BIGINT NOT NULL,
    `valid_from` DATE COMMENT 'Bekende ingangsdatum inclusief; NULL betekent onbekend.',
    `valid_until` DATE COMMENT 'Bekende einddatum exclusief; NULL betekent onbekend, niet onbeperkt geldig.',
    `observed_on` DATE NOT NULL COMMENT 'Datum waarop de beschrijving is waargenomen; geen vervanging voor een ingangsdatum.',
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `relation_date_kind` TINYINT GENERATED ALWAYS AS (valid_from IS NULL) STORED COMMENT '0: bekende start; 1: onbekende start met observatiedatum. Alleen voor unieke index.',
    `relation_date` DATE GENERATED ALWAYS AS (COALESCE(valid_from, observed_on)) STORED COMMENT 'Indexdatum; bij onbekende start blijft valid_from NULL en wordt observed_on gebruikt.',
    CONSTRAINT `ck_system_technologies_1` CHECK (code REGEXP '^[a-z][a-z0-9_]*$' AND code NOT REGEXP '[^a-z0-9_]'),
    UNIQUE KEY `system_technologies_code_uq` (`code`),
    CONSTRAINT `ck_system_technologies_2` CHECK (usage_role IN ('implements','runs_on','uses','other')),
    CONSTRAINT `ck_system_technologies_3` CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until),
    UNIQUE KEY `system_technologies_relation_date_uq` (`system_id`,`technology_id`,`usage_role`,`relation_date_kind`,`relation_date`),
    KEY `system_technologies_technology_idx` (`technology_id`),
    KEY `system_technologies_evidence_idx` (`evidence_id`),
    KEY `system_technologies_system_idx` (`system_id`),
    CONSTRAINT `fk_system_technologies_system_id` FOREIGN KEY (`system_id`) REFERENCES `digital_systems` (`id`),
    CONSTRAINT `fk_system_technologies_technology_id` FOREIGN KEY (`technology_id`) REFERENCES `technologies` (`id`),
    CONSTRAINT `fk_system_technologies_evidence_id` FOREIGN KEY (`evidence_id`) REFERENCES `evidence` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Technologiegebruik per systeem, met eigen onderbouwing in plaats van een aanname uit algemene documentatie.';

CREATE TABLE `data_flows` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `name` TEXT NOT NULL,
    `from_system_id` BIGINT NOT NULL,
    `to_system_id` BIGINT NOT NULL,
    `purpose` TEXT NOT NULL,
    `flow_status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `exchange_mode` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'unknown',
    `technology_id` BIGINT,
    `evidence_id` BIGINT NOT NULL,
    `valid_from` DATE COMMENT 'Bekende ingangsdatum inclusief; NULL betekent onbekend.',
    `valid_until` DATE COMMENT 'Bekende einddatum exclusief; NULL betekent onbekend, niet onbeperkt geldig.',
    `observed_on` DATE NOT NULL COMMENT 'Datum waarop de beschrijving is waargenomen; geen vervanging voor een ingangsdatum.',
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    CONSTRAINT `ck_data_flows_1` CHECK (code REGEXP '^[a-z][a-z0-9_]*$' AND code NOT REGEXP '[^a-z0-9_]'),
    UNIQUE KEY `data_flows_code_uq` (`code`),
    CONSTRAINT `ck_data_flows_2` CHECK (TRIM(name) <> ''),
    CONSTRAINT `ck_data_flows_3` CHECK (TRIM(purpose) <> ''),
    CONSTRAINT `ck_data_flows_4` CHECK (flow_status IN ('planned','pilot','operational','retired')),
    CONSTRAINT `ck_data_flows_5` CHECK (exchange_mode IN ('query','message','batch','stream','file','unknown')),
    CONSTRAINT `ck_data_flows_6` CHECK (from_system_id <> to_system_id),
    CONSTRAINT `ck_data_flows_7` CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until),
    KEY `data_flows_from_idx` (`from_system_id`),
    KEY `data_flows_to_idx` (`to_system_id`),
    KEY `data_flows_technology_idx` (`technology_id`),
    KEY `data_flows_evidence_idx` (`evidence_id`),
    CONSTRAINT `fk_data_flows_from_system_id` FOREIGN KEY (`from_system_id`) REFERENCES `digital_systems` (`id`),
    CONSTRAINT `fk_data_flows_to_system_id` FOREIGN KEY (`to_system_id`) REFERENCES `digital_systems` (`id`),
    CONSTRAINT `fk_data_flows_technology_id` FOREIGN KEY (`technology_id`) REFERENCES `technologies` (`id`),
    CONSTRAINT `fk_data_flows_evidence_id` FOREIGN KEY (`evidence_id`) REFERENCES `evidence` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Gerichte gegevensuitwisseling tussen systemen; operationele status vereist eigen onderbouwing.';

CREATE TABLE `data_flow_datasets` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `data_flow_id` BIGINT NOT NULL,
    `dataset_id` BIGINT NOT NULL,
    `notes` TEXT,
    `evidence_id` BIGINT NOT NULL,
    `valid_from` DATE COMMENT 'Bekende ingangsdatum inclusief; NULL betekent onbekend.',
    `valid_until` DATE COMMENT 'Bekende einddatum exclusief; NULL betekent onbekend, niet onbeperkt geldig.',
    `observed_on` DATE NOT NULL COMMENT 'Datum waarop de beschrijving is waargenomen; geen vervanging voor een ingangsdatum.',
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `relation_date_kind` TINYINT GENERATED ALWAYS AS (valid_from IS NULL) STORED COMMENT '0: bekende start; 1: onbekende start met observatiedatum. Alleen voor unieke index.',
    `relation_date` DATE GENERATED ALWAYS AS (COALESCE(valid_from, observed_on)) STORED COMMENT 'Indexdatum; bij onbekende start blijft valid_from NULL en wordt observed_on gebruikt.',
    CONSTRAINT `ck_data_flow_datasets_1` CHECK (code REGEXP '^[a-z][a-z0-9_]*$' AND code NOT REGEXP '[^a-z0-9_]'),
    UNIQUE KEY `data_flow_datasets_code_uq` (`code`),
    CONSTRAINT `ck_data_flow_datasets_2` CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until),
    UNIQUE KEY `data_flow_datasets_relation_date_uq` (`data_flow_id`,`dataset_id`,`relation_date_kind`,`relation_date`),
    KEY `data_flow_datasets_dataset_idx` (`dataset_id`),
    KEY `data_flow_datasets_evidence_idx` (`evidence_id`),
    KEY `data_flow_datasets_flow_idx` (`data_flow_id`),
    CONSTRAINT `fk_data_flow_datasets_data_flow_id` FOREIGN KEY (`data_flow_id`) REFERENCES `data_flows` (`id`),
    CONSTRAINT `fk_data_flow_datasets_dataset_id` FOREIGN KEY (`dataset_id`) REFERENCES `datasets` (`id`),
    CONSTRAINT `fk_data_flow_datasets_evidence_id` FOREIGN KEY (`evidence_id`) REFERENCES `evidence` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Gegevensverzamelingen die bij een beschreven stroom horen.';

CREATE TABLE `programme_targets` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `programme_id` BIGINT NOT NULL,
    `system_id` BIGINT,
    `dataset_id` BIGINT,
    `change_kind` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `notes` TEXT,
    `evidence_id` BIGINT NOT NULL,
    `valid_from` DATE COMMENT 'Bekende ingangsdatum inclusief; NULL betekent onbekend.',
    `valid_until` DATE COMMENT 'Bekende einddatum exclusief; NULL betekent onbekend, niet onbeperkt geldig.',
    `observed_on` DATE NOT NULL COMMENT 'Datum waarop de beschrijving is waargenomen; geen vervanging voor een ingangsdatum.',
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `relation_date_kind` TINYINT GENERATED ALWAYS AS (valid_from IS NULL) STORED COMMENT '0: bekende start; 1: onbekende start met observatiedatum. Alleen voor unieke index.',
    `relation_date` DATE GENERATED ALWAYS AS (COALESCE(valid_from, observed_on)) STORED COMMENT 'Indexdatum; bij onbekende start blijft valid_from NULL en wordt observed_on gebruikt.',
    `target_kind` VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN system_id IS NOT NULL THEN 'system' ELSE 'dataset' END) STORED,
    `target_key` BIGINT GENERATED ALWAYS AS (COALESCE(system_id, dataset_id)) STORED,
    CONSTRAINT `ck_programme_targets_1` CHECK (code REGEXP '^[a-z][a-z0-9_]*$' AND code NOT REGEXP '[^a-z0-9_]'),
    UNIQUE KEY `programme_targets_code_uq` (`code`),
    CONSTRAINT `ck_programme_targets_2` CHECK (change_kind IN ('creates','modernizes','replaces','retires','studies','other')),
    CONSTRAINT `ck_programme_targets_3` CHECK (((system_id IS NOT NULL) + (dataset_id IS NOT NULL)) = 1),
    CONSTRAINT `ck_programme_targets_4` CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until),
    UNIQUE KEY `programme_targets_relation_date_uq` (`programme_id`,`target_kind`,`target_key`,`change_kind`,`relation_date_kind`,`relation_date`),
    KEY `programme_targets_system_idx` (`system_id`),
    KEY `programme_targets_dataset_idx` (`dataset_id`),
    KEY `programme_targets_evidence_idx` (`evidence_id`),
    KEY `programme_targets_programme_idx` (`programme_id`),
    CONSTRAINT `fk_programme_targets_programme_id` FOREIGN KEY (`programme_id`) REFERENCES `programmes` (`id`),
    CONSTRAINT `fk_programme_targets_system_id` FOREIGN KEY (`system_id`) REFERENCES `digital_systems` (`id`),
    CONSTRAINT `fk_programme_targets_dataset_id` FOREIGN KEY (`dataset_id`) REFERENCES `datasets` (`id`),
    CONSTRAINT `fk_programme_targets_evidence_id` FOREIGN KEY (`evidence_id`) REFERENCES `evidence` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Veranderdoel van een programma: precies één systeem of gegevensverzameling per rij.';

CREATE TABLE `event_subjects` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `event_id` BIGINT NOT NULL,
    `organization_id` BIGINT,
    `territory_id` BIGINT,
    `public_function_id` BIGINT,
    `system_id` BIGINT,
    `dataset_id` BIGINT,
    `technology_id` BIGINT,
    `programme_id` BIGINT,
    `source_id` BIGINT,
    `subject_role` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'subject',
    `notes` TEXT,
    `evidence_id` BIGINT NOT NULL,
    `observed_on` DATE NOT NULL COMMENT 'Datum waarop de beschrijving is waargenomen; geen vervanging voor een ingangsdatum.',
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    CONSTRAINT `ck_event_subjects_1` CHECK (code REGEXP '^[a-z][a-z0-9_]*$' AND code NOT REGEXP '[^a-z0-9_]'),
    UNIQUE KEY `event_subjects_code_uq` (`code`),
    CONSTRAINT `ck_event_subjects_2` CHECK (subject_role IN ('subject','context')),
    CONSTRAINT `ck_event_subjects_3` CHECK (((organization_id IS NOT NULL) + (territory_id IS NOT NULL) + (public_function_id IS NOT NULL) + (system_id IS NOT NULL) + (dataset_id IS NOT NULL) + (technology_id IS NOT NULL) + (programme_id IS NOT NULL) + (source_id IS NOT NULL)) = 1),
    UNIQUE KEY `event_subjects_organization_uq` (`event_id`,`organization_id`),
    UNIQUE KEY `event_subjects_territory_uq` (`event_id`,`territory_id`),
    UNIQUE KEY `event_subjects_public_function_uq` (`event_id`,`public_function_id`),
    UNIQUE KEY `event_subjects_system_uq` (`event_id`,`system_id`),
    UNIQUE KEY `event_subjects_dataset_uq` (`event_id`,`dataset_id`),
    UNIQUE KEY `event_subjects_technology_uq` (`event_id`,`technology_id`),
    UNIQUE KEY `event_subjects_programme_uq` (`event_id`,`programme_id`),
    UNIQUE KEY `event_subjects_source_uq` (`event_id`,`source_id`),
    KEY `event_subjects_evidence_idx` (`evidence_id`),
    KEY `event_subjects_organization_idx` (`organization_id`),
    KEY `event_subjects_territory_idx` (`territory_id`),
    KEY `event_subjects_function_idx` (`public_function_id`),
    KEY `event_subjects_system_idx` (`system_id`),
    KEY `event_subjects_dataset_idx` (`dataset_id`),
    KEY `event_subjects_technology_idx` (`technology_id`),
    KEY `event_subjects_programme_idx` (`programme_id`),
    KEY `event_subjects_source_idx` (`source_id`),
    KEY `event_subjects_event_idx` (`event_id`),
    CONSTRAINT `fk_event_subjects_event_id` FOREIGN KEY (`event_id`) REFERENCES `historical_events` (`id`),
    CONSTRAINT `fk_event_subjects_organization_id` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
    CONSTRAINT `fk_event_subjects_territory_id` FOREIGN KEY (`territory_id`) REFERENCES `territories` (`id`),
    CONSTRAINT `fk_event_subjects_public_function_id` FOREIGN KEY (`public_function_id`) REFERENCES `public_functions` (`id`),
    CONSTRAINT `fk_event_subjects_system_id` FOREIGN KEY (`system_id`) REFERENCES `digital_systems` (`id`),
    CONSTRAINT `fk_event_subjects_dataset_id` FOREIGN KEY (`dataset_id`) REFERENCES `datasets` (`id`),
    CONSTRAINT `fk_event_subjects_technology_id` FOREIGN KEY (`technology_id`) REFERENCES `technologies` (`id`),
    CONSTRAINT `fk_event_subjects_programme_id` FOREIGN KEY (`programme_id`) REFERENCES `programmes` (`id`),
    CONSTRAINT `fk_event_subjects_source_id` FOREIGN KEY (`source_id`) REFERENCES `sources` (`id`),
    CONSTRAINT `fk_event_subjects_evidence_id` FOREIGN KEY (`evidence_id`) REFERENCES `evidence` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Getypeerde gebeurteniskoppeling met echte foreign keys; de achtste doelsoort is een bronpublicatie.';

CREATE TABLE `audit_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `recorded_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `table_name` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `row_id` BIGINT NOT NULL,
    `operation` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `database_session_user` VARCHAR(400) NOT NULL,
    `actor_id` TEXT COMMENT 'Optionele sessiecontext app.actor_id, niet door dit schema geauthenticeerd.',
    `old_values` JSON,
    `new_values` JSON,
    CONSTRAINT `ck_audit_log_1` CHECK (operation IN ('INSERT','UPDATE','DELETE')),
    CONSTRAINT `ck_audit_log_2` CHECK ((operation = 'INSERT' AND old_values IS NULL AND new_values IS NOT NULL)
        OR (operation = 'UPDATE' AND old_values IS NOT NULL AND new_values IS NOT NULL)
        OR (operation = 'DELETE' AND old_values IS NOT NULL AND new_values IS NULL)),
    KEY `audit_log_row_idx` (`table_name`,`row_id`,`recorded_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Wijzigingslog voor gewone rijmutaties; geen onveranderbaar beveiligingsbewijs. Rechten en export moeten apart worden ingericht.';

CREATE TABLE `system_functions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `system_id` BIGINT NOT NULL,
    `function_id` BIGINT NOT NULL,
    `usage_role` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `notes` TEXT,
    `evidence_id` BIGINT NOT NULL,
    `valid_from` DATE COMMENT 'Bekende ingangsdatum inclusief; NULL betekent onbekend.',
    `valid_until` DATE COMMENT 'Bekende einddatum exclusief; NULL betekent onbekend, niet onbeperkt geldig.',
    `observed_on` DATE NOT NULL COMMENT 'Datum waarop de beschrijving is waargenomen; geen vervanging voor een ingangsdatum.',
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT 'UTC volgens verbindingscontract: iedere schrijvende verbinding gebruikt time_zone +00:00.',
    `relation_date_kind` TINYINT GENERATED ALWAYS AS (valid_from IS NULL) STORED COMMENT '0: bekende start; 1: onbekende start met observatiedatum. Alleen voor unieke index.',
    `relation_date` DATE GENERATED ALWAYS AS (COALESCE(valid_from, observed_on)) STORED COMMENT 'Indexdatum; bij onbekende start blijft valid_from NULL en wordt observed_on gebruikt.',
    CONSTRAINT `ck_system_functions_1` CHECK (code REGEXP '^[a-z][a-z0-9_]*$' AND code NOT REGEXP '[^a-z0-9_]'),
    UNIQUE KEY `system_functions_code_uq` (`code`),
    CONSTRAINT `ck_system_functions_2` CHECK (usage_role IN ('supports','automates','publishes','provides_access')),
    CONSTRAINT `ck_system_functions_3` CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until),
    UNIQUE KEY `system_functions_relation_date_uq` (`system_id`,`function_id`,`usage_role`,`relation_date_kind`,`relation_date`),
    KEY `system_functions_system_idx` (`system_id`),
    KEY `system_functions_function_idx` (`function_id`),
    KEY `system_functions_evidence_idx` (`evidence_id`),
    CONSTRAINT `fk_system_functions_system_id` FOREIGN KEY (`system_id`) REFERENCES `digital_systems` (`id`),
    CONSTRAINT `fk_system_functions_function_id` FOREIGN KEY (`function_id`) REFERENCES `public_functions` (`id`),
    CONSTRAINT `fk_system_functions_evidence_id` FOREIGN KEY (`evidence_id`) REFERENCES `evidence` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Verbindt digitale ondersteuning aan een taak of dienst; ondersteuning draagt het mandaat niet over.';

-- Directe zelfverwijzing public_functions.parent_function_id = id kan niet
-- als MySQL CHECK worden geschreven omdat id AUTO_INCREMENT gebruikt.
-- De verplichte kwaliteitsview meldt dit; 04_audit_optie.sql kan dit optioneel
-- in AFTER INSERT / AFTER UPDATE triggers blokkeren nadat id is toegekend.
-- Alle foreign keys hebben een index en werken zonder verwijdercascades.
-- Geen NULL-datum wordt als oneindig of als daadwerkelijk actuele toestand uitgelegd.
-- Generated relation_date* en target_* zijn indexhulpen, geen nieuwe bronfeiten.

-- ONDERDEEL: 03_views.sql

-- Drie leesviews voor de geselecteerde database.
-- Maak eerst de tabellen met 01_schema.sql. Geen CREATE OR REPLACE: een
-- bestaande view wordt nooit ongemerkt overschreven.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+00:00';

-- Eén representatieve bron van een beoordeelde bewering; de bronlink
-- zelf is geen waarheidscontrole. De volledige bibliografie blijft in
-- evidence_sources beschikbaar.
CREATE SQL SECURITY INVOKER VIEW `v_system_catalog` AS
SELECT
    ds.id, ds.code, ds.name, ds.description, ds.system_kind,
    ds.lifecycle_status, ds.observed_on, ds.evidence_id,
    ev.statement AS evidence_statement,
    ev.status AS evidence_status,
    ev.assessment_date,
    src.id AS reviewed_source_id,
    src.title AS reviewed_source_title,
    src.url AS reviewed_source_url,
    chosen.claim_locator AS reviewed_claim_locator
FROM digital_systems ds
JOIN evidence ev ON ev.id = ds.evidence_id
LEFT JOIN evidence_sources chosen ON chosen.id = (
    SELECT candidate.id
    FROM evidence_sources candidate
    JOIN sources candidate_source ON candidate_source.id = candidate.source_id
    WHERE candidate.evidence_id = ev.id
      AND candidate.relation_kind = 'supports'
      AND ev.status IN ('reviewed','published')
    ORDER BY candidate_source.retrieved_on DESC, candidate_source.id DESC, candidate.id DESC
    LIMIT 1
)
LEFT JOIN sources src ON src.id = chosen.source_id;

-- De datumgrenzen zijn inclusief en geven dateringsonzekerheid weer.
-- Gebruik voor weergave date_label; sorteer expliciet op earliest_date.
-- GROUP_CONCAT heeft een sessiegrens. subject_names_complete=0 meldt
-- afkapping, zodat een afgekorte lijst nooit als compleet wordt voorgesteld.
CREATE SQL SECURITY INVOKER VIEW `v_timeline` AS
SELECT
    he.id, he.code, he.title, he.description, he.event_kind,
    he.earliest_date, he.latest_date, he.date_precision, he.date_label,
    he.observed_on, he.evidence_id,
    ev.status AS evidence_status, ev.assessment_date,
    related.subject_names,
    COALESCE(related.subject_count, 0) AS subject_count,
    CASE WHEN related.event_id IS NULL THEN 1
         WHEN OCTET_LENGTH(related.subject_names) = related.expected_bytes THEN 1
         ELSE 0 END AS subject_names_complete
FROM historical_events he
JOIN evidence ev ON ev.id = he.evidence_id
LEFT JOIN (
    SELECT
        es.event_id,
        GROUP_CONCAT(
            COALESCE(org.name, terr.name, fn.name, ds.name,
                     dat.name, tech.name, prog.name, src.title)
            ORDER BY es.id SEPARATOR '; '
        ) AS subject_names,
        COUNT(*) AS subject_count,
        SUM(OCTET_LENGTH(COALESCE(org.name, terr.name, fn.name, ds.name,
                                 dat.name, tech.name, prog.name, src.title)))
            + 2 * (COUNT(*) - 1) AS expected_bytes
    FROM event_subjects es
    LEFT JOIN organizations org ON org.id = es.organization_id
    LEFT JOIN territories terr ON terr.id = es.territory_id
    LEFT JOIN public_functions fn ON fn.id = es.public_function_id
    LEFT JOIN digital_systems ds ON ds.id = es.system_id
    LEFT JOIN datasets dat ON dat.id = es.dataset_id
    LEFT JOIN technologies tech ON tech.id = es.technology_id
    LEFT JOIN programmes prog ON prog.id = es.programme_id
    LEFT JOIN sources src ON src.id = es.source_id
    GROUP BY es.event_id
) related ON related.event_id = he.id;

-- Alleen volledig bekende geldigheidsperioden worden als overlap getoond.
-- NULL betekent onbekend, niet eeuwig geldig. Organisatiepaden met een
-- onbekende grens leveren hoogstens een mogelijke cyclus op.
-- Cycluscontrole onderzoekt maximaal 256 stappen per pad. Een bereikte
-- dieptelimiet wordt zichtbaar gemeld; dit is geen bewijs van cyclusvrijheid.
CREATE SQL SECURITY INVOKER VIEW `v_quality_issues` AS
WITH RECURSIVE
temporal_links AS (
    SELECT 'organization_relations' AS table_name, id, code,
           CONCAT(from_organization_id,'/',to_organization_id,'/',relation_kind) AS relation_key,
           valid_from, valid_until FROM organization_relations
    UNION ALL
    SELECT 'mandates',id,code,CONCAT(organization_id,'/',public_function_id,'/',territory_id,'/',mandate_kind),
           valid_from,valid_until FROM mandates
    UNION ALL
    SELECT 'system_responsibilities',id,code,CONCAT(organization_id,'/',system_id,'/',responsibility_role),
           valid_from,valid_until FROM system_responsibilities
    UNION ALL
    SELECT 'dataset_responsibilities',id,code,CONCAT(organization_id,'/',dataset_id,'/',responsibility_role),
           valid_from,valid_until FROM dataset_responsibilities
    UNION ALL
    SELECT 'system_dataset_usage',id,code,CONCAT(system_id,'/',dataset_id,'/',usage_role),
           valid_from,valid_until FROM system_dataset_usage
    UNION ALL
    SELECT 'system_technologies',id,code,CONCAT(system_id,'/',technology_id,'/',usage_role),
           valid_from,valid_until FROM system_technologies
    UNION ALL
    SELECT 'data_flow_datasets',id,code,CONCAT(data_flow_id,'/',dataset_id),
           valid_from,valid_until FROM data_flow_datasets
    UNION ALL
    SELECT 'programme_targets',id,code,CONCAT(programme_id,'/',target_kind,'/',target_key,'/',change_kind),
           valid_from,valid_until FROM programme_targets
    UNION ALL
    SELECT 'system_functions',id,code,CONCAT(system_id,'/',function_id,'/',usage_role),
           valid_from,valid_until FROM system_functions
),
organization_paths AS (
    SELECT
        rel.from_organization_id AS root_id,
        rel.to_organization_id AS current_id,
        CAST(CONCAT('/',rel.from_organization_id,'/',rel.to_organization_id,'/') AS CHAR(6000) CHARACTER SET ascii) AS node_path,
        rel.valid_from AS window_from,
        rel.valid_until AS window_until,
        (rel.valid_from IS NOT NULL AND rel.valid_until IS NOT NULL) AS all_bounds_known,
        (rel.from_organization_id = rel.to_organization_id) AS has_cycle,
        1 AS path_depth
    FROM organization_relations rel
    WHERE rel.relation_kind = 'administrative_part_of'
    UNION ALL
    SELECT
        path.root_id,
        rel.to_organization_id,
        CONCAT(path.node_path,rel.to_organization_id,'/'),
        CASE WHEN path.window_from IS NULL THEN rel.valid_from
             WHEN rel.valid_from IS NULL THEN path.window_from
             ELSE GREATEST(path.window_from,rel.valid_from) END,
        CASE WHEN path.window_until IS NULL THEN rel.valid_until
             WHEN rel.valid_until IS NULL THEN path.window_until
             ELSE LEAST(path.window_until,rel.valid_until) END,
        path.all_bounds_known AND rel.valid_from IS NOT NULL AND rel.valid_until IS NOT NULL,
        LOCATE(CONCAT('/',rel.to_organization_id,'/'),path.node_path) > 0,
        path.path_depth + 1
    FROM organization_paths path
    JOIN organization_relations rel ON rel.from_organization_id = path.current_id
    WHERE path.has_cycle = 0 AND path.path_depth < 256
      AND rel.relation_kind = 'administrative_part_of'
      AND (
          (path.window_from IS NULL AND rel.valid_from IS NULL)
          OR (path.window_until IS NULL AND rel.valid_until IS NULL)
          OR (CASE WHEN path.window_from IS NULL THEN rel.valid_from
                   WHEN rel.valid_from IS NULL THEN path.window_from
                   ELSE GREATEST(path.window_from,rel.valid_from) END)
             < (CASE WHEN path.window_until IS NULL THEN rel.valid_until
                     WHEN rel.valid_until IS NULL THEN path.window_until
                     ELSE LEAST(path.window_until,rel.valid_until) END)
      )
),
function_paths AS (
    SELECT
        fn.id AS root_id,
        fn.parent_function_id AS current_id,
        CAST(CONCAT('/',fn.id,'/',fn.parent_function_id,'/') AS CHAR(6000) CHARACTER SET ascii) AS node_path,
        (fn.id = fn.parent_function_id) AS has_cycle,
        1 AS path_depth
    FROM public_functions fn
    WHERE fn.parent_function_id IS NOT NULL
    UNION ALL
    SELECT
        path.root_id,
        fn.parent_function_id,
        CONCAT(path.node_path,fn.parent_function_id,'/'),
        LOCATE(CONCAT('/',fn.parent_function_id,'/'),path.node_path) > 0,
        path.path_depth + 1
    FROM function_paths path
    JOIN public_functions fn ON fn.id = path.current_id
    WHERE path.has_cycle = 0 AND path.path_depth < 256
      AND fn.parent_function_id IS NOT NULL
)
SELECT
    'evidence_without_source' AS issue_code,
    CASE WHEN ev.status = 'draft' THEN 'info' ELSE 'warning' END AS severity,
    'evidence' AS table_name,
    ev.id AS record_id,
    ev.code AS record_code,
    'Er is nog geen bron met een concrete vindplaats gekoppeld.' AS detail
FROM evidence ev
WHERE NOT EXISTS (SELECT 1 FROM evidence_sources es WHERE es.evidence_id = ev.id)
UNION ALL
SELECT 'evidence_without_support','warning','evidence',ev.id,ev.code,
       'Er zijn bronkoppelingen, maar geen daarvan is als ondersteunend beoordeeld.'
FROM evidence ev
WHERE EXISTS (SELECT 1 FROM evidence_sources es WHERE es.evidence_id = ev.id)
  AND NOT EXISTS (SELECT 1 FROM evidence_sources es WHERE es.evidence_id = ev.id AND es.relation_kind = 'supports')
UNION ALL
SELECT 'known_period_overlap','warning',a.table_name,a.id,a.code,
       CONCAT('Bekende geldigheidsperioden overlappen met ',b.code,'. Beoordeel of dit dubbele of onjuist gescheiden registraties zijn.')
FROM temporal_links a
JOIN temporal_links b ON b.table_name = a.table_name AND b.relation_key = a.relation_key AND a.id < b.id
WHERE a.valid_from IS NOT NULL AND a.valid_until IS NOT NULL
  AND b.valid_from IS NOT NULL AND b.valid_until IS NOT NULL
  AND a.valid_from < b.valid_until AND b.valid_from < a.valid_until
UNION ALL
SELECT DISTINCT 'organization_cycle','warning','organizations',org.id,org.code,
       CASE WHEN path.all_bounds_known = 1
            THEN 'Cyclus in administrative_part_of binnen overlappende bekende geldigheidsperioden.'
            ELSE 'Mogelijke cyclus in administrative_part_of; onbekende geldigheidsgrenzen moeten eerst worden onderzocht.' END
FROM organization_paths path
JOIN organizations org ON org.id = path.root_id
WHERE path.has_cycle = 1 AND path.current_id = path.root_id
UNION ALL
SELECT DISTINCT 'function_cycle','warning','public_functions',fn.id,fn.code,
       'Cyclus in de inhoudelijke groepering via parent_function_id; ook een directe zelfverwijzing valt hieronder.'
FROM function_paths path
JOIN public_functions fn ON fn.id = path.root_id
WHERE path.has_cycle = 1 AND path.current_id = path.root_id
UNION ALL
SELECT DISTINCT 'organization_depth_limit','warning','organizations',org.id,org.code,
       'Cycluscontrole bereikt 256 stappen; verdere handmatige controle is nodig.'
FROM organization_paths path
JOIN organizations org ON org.id = path.root_id
WHERE path.path_depth = 256 AND path.has_cycle = 0
  AND EXISTS (SELECT 1 FROM organization_relations rel
              WHERE rel.from_organization_id = path.current_id
                AND rel.relation_kind = 'administrative_part_of')
UNION ALL
SELECT DISTINCT 'function_depth_limit','warning','public_functions',fn.id,fn.code,
       'Cycluscontrole bereikt 256 stappen; verdere handmatige controle is nodig.'
FROM function_paths path
JOIN public_functions fn ON fn.id = path.root_id
WHERE path.path_depth = 256 AND path.has_cycle = 0
  AND EXISTS (SELECT 1 FROM public_functions next_fn
              WHERE next_fn.id = path.current_id AND next_fn.parent_function_id IS NOT NULL);

-- Een lege kwaliteitsview betekent uitsluitend dat deze controles niets
-- melden. Zij bewijst geen juistheid, actualiteit, volledigheid of overlapvrijheid.

-- ONDERDEEL: 02_seed.sql

-- BESTUURSATLAS: brononderbouwde voorbeeldgegevens voor MySQL/MariaDB.
-- Eerst tabellen aanmaken in de geselecteerde database.
-- Geen INSERT IGNORE: fouten in verwijzingen worden niet stilzwijgend genegeerd.
-- Een bestaande code wordt niet gewijzigd. Voer imports niet gelijktijdig uit.
-- Peildatum en broncontrole: 2026-10-28. Onbekende geldigheidsdatums blijven NULL.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+00:00';
START TRANSACTION;
SET @bestuursatlas_actor_id = 'seed_onderzoek_20261028';

-- sources
INSERT INTO `sources` (code, title, publisher, url, source_kind, publication_date, retrieved_on, notes)
SELECT 's1_logius_digid_gegevens', 'Gegevensverwerkingen DigiD', 'Logius', 'https://www.logius.nl/onze-dienstverlening/toegang/digid/documentatie/gegevensverwerkingen-digid', 'documentation', NULL, DATE '2026-10-28', 'Bron S1. Actuele verwerkingenbeschrijving; publicatiedatum niet vastgesteld.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `sources` AS existing_seed_row ON existing_seed_row.code = 's1_logius_digid_gegevens'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `sources` (code, title, publisher, url, source_kind, publication_date, retrieved_on, notes)
SELECT 's2_mijnoverheid_privacy', 'Privacyverklaring MijnOverheid', 'Logius / MijnOverheid', 'https://mijn.overheid.nl/privacy/', 'documentation', NULL, DATE '2026-10-28', 'Bron S2. De pagina vermeldt 9 september 2026 als laatste wijziging; dat is hier niet als publicatiedatum gebruikt.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `sources` AS existing_seed_row ON existing_seed_row.code = 's2_mijnoverheid_privacy'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `sources` (code, title, publisher, url, source_kind, publication_date, retrieved_on, notes)
SELECT 's3_mijnoverheid_werking', 'Hoe werkt MijnOverheid?', 'Logius', 'https://www.logius.nl/onze-dienstverlening/interactie/voorzieningen/mijnoverheid/hoe-werkt-het', 'documentation', NULL, DATE '2026-10-28', 'Bron S3. Alleen concrete functies en techniekgebruik zijn overgenomen; geen absolute veiligheidsclaims.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `sources` AS existing_seed_row ON existing_seed_row.code = 's3_mijnoverheid_werking'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `sources` (code, title, publisher, url, source_kind, publication_date, retrieved_on, notes)
SELECT 's4_rvig_brp_beheer', 'Beheer van de gegevens in de Basisregistratie Personen (BRP)', 'Rijksdienst voor Identiteitsgegevens', 'https://www.rvig.nl/beheer-van-de-gegevens-de-basisregistratie-personen-brp', 'documentation', NULL, DATE '2026-10-28', 'Bron S4. Onderscheidt gemeentelijk beheer, niet-ingezetenen en de verstrekkingsvoorziening.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `sources` AS existing_seed_row ON existing_seed_row.code = 's4_rvig_brp_beheer'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `sources` (code, title, publisher, url, source_kind, publication_date, retrieved_on, notes)
SELECT 's5_rvig_brpv_adhoc', 'Zoeken via de Ad-hoc-webservice van BRP-V', 'Rijksdienst voor Identiteitsgegevens', 'https://rvig.nl/node/2281', 'documentation', NULL, DATE '2026-10-28', 'Bron S5. Gebruikt voor de BRP/RNI-mijlpaal en voor de vereiste autorisatie; geen persoonsrecords overgenomen.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `sources` AS existing_seed_row ON existing_seed_row.code = 's5_rvig_brpv_adhoc'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `sources` (code, title, publisher, url, source_kind, publication_date, retrieved_on, notes)
SELECT 's6_kadaster_over_bag', 'Over BAG', 'Kadaster', 'https://www.kadaster.nl/zakelijk/registraties/basisregistraties/bag/over-bag', 'documentation', NULL, DATE '2026-10-28', 'Bron S6. Onderscheidt de registratie BAG, gemeentelijke bronhouders en beheer van LV-BAG.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `sources` AS existing_seed_row ON existing_seed_row.code = 's6_kadaster_over_bag'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `sources` (code, title, publisher, url, source_kind, publication_date, retrieved_on, notes)
SELECT 's7_kadaster_bag_api', 'BAG API Individuele Bevragingen', 'Kadaster', 'https://www.kadaster.nl/zakelijk/producten/adressen-en-gebouwen/bag-api-individuele-bevragingen', 'documentation', NULL, DATE '2026-10-28', 'Bron S7. REST/JSON is expliciet vermeld voor deze API; geen volledige technologie-inventaris van LV-BAG.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `sources` AS existing_seed_row ON existing_seed_row.code = 's7_kadaster_bag_api'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `sources` (code, title, publisher, url, source_kind, publication_date, retrieved_on, notes)
SELECT 's8_kamerstuk_digid_lancering', 'Kamerstuk 34 258, nr. 10 — gewijzigde memorie van toelichting', 'Tweede Kamer der Staten-Generaal', 'https://zoek.officielebekendmakingen.nl/kst-34258-10.html', 'report', DATE '2016-11-08', DATE '2026-10-28', 'Bron S8. Alleen de expliciete historische mededeling over de lancering van DigiD wordt gebruikt; het wetsvoorstel is geen bewijs van latere uitvoering.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `sources` AS existing_seed_row ON existing_seed_row.code = 's8_kamerstuk_digid_lancering'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `sources` (code, title, publisher, url, source_kind, publication_date, retrieved_on, notes)
SELECT 's9_bzk_jaarverslag_2017', 'Jaarverslag 2017 — VII Binnenlandse Zaken en Koninkrijksrelaties', 'Ministerie van Binnenlandse Zaken en Koninkrijksrelaties / Rijksfinancien', 'https://www.rijksfinancien.nl/jaarverslag/2017/VII', 'report', NULL, DATE '2026-10-28', 'Bron S9. Verslagjaar 2017 is niet als publicatiedatum ingevuld. Projectstop en registratiecontinuiteit zijn afzonderlijke begrippen.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `sources` AS existing_seed_row ON existing_seed_row.code = 's9_bzk_jaarverslag_2017'
WHERE existing_seed_row.id IS NULL;

-- evidence
INSERT INTO `evidence` (code, statement, status, assessment_date, assessment_note)
SELECT 'c01_logius_onderdeel_bzk', 'Logius is onderdeel van het ministerie van Binnenlandse Zaken en Koninkrijksrelaties.', 'reviewed', DATE '2026-10-28', 'Primaire bronpassage gecontroleerd. reviewed betekent broncontrole, geen juridische validatie of volledigheidsgarantie.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence` AS existing_seed_row ON existing_seed_row.code = 'c01_logius_onderdeel_bzk'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence` (code, statement, status, assessment_date, assessment_note)
SELECT 'c02_rvig_naam', 'RvIG staat voor Rijksdienst voor Identiteitsgegevens.', 'reviewed', DATE '2026-10-28', 'Primaire bronpassage gecontroleerd. reviewed betekent broncontrole, geen juridische validatie of volledigheidsgarantie.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence` AS existing_seed_row ON existing_seed_row.code = 'c02_rvig_naam'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence` (code, statement, status, assessment_date, assessment_note)
SELECT 'c03_kadaster_beheert_lv_bag', 'Het Kadaster beheert de Landelijke Voorziening BAG.', 'reviewed', DATE '2026-10-28', 'Primaire bronpassage gecontroleerd. reviewed betekent broncontrole, geen juridische validatie of volledigheidsgarantie.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence` AS existing_seed_row ON existing_seed_row.code = 'c03_kadaster_beheert_lv_bag'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence` (code, statement, status, assessment_date, assessment_note)
SELECT 'c04_digid_authenticatie', 'DigiD is een elektronische authenticatievoorziening.', 'reviewed', DATE '2026-10-28', 'Primaire bronpassage gecontroleerd. reviewed betekent broncontrole, geen juridische validatie of volledigheidsgarantie.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence` AS existing_seed_row ON existing_seed_row.code = 'c04_digid_authenticatie'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence` (code, statement, status, assessment_date, assessment_note)
SELECT 'c05_brp_ingezetenen_niet_ingezetenen', 'De BRP bevat persoonsgegevens van ingezetenen en niet-ingezetenen.', 'reviewed', DATE '2026-10-28', 'Primaire bronpassage gecontroleerd. reviewed betekent broncontrole, geen juridische validatie of volledigheidsgarantie. Dezelfde RvIG-handleiding beschrijft in De ad-hoc-vraag de autorisatie-eisen; daarom is de toegang tot de registratie als restricted gemodelleerd.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence` AS existing_seed_row ON existing_seed_row.code = 'c05_brp_ingezetenen_niet_ingezetenen'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence` (code, statement, status, assessment_date, assessment_note)
SELECT 'c06_brpv_verstrekkingsvoorziening', 'BRP-V is de verstrekkingsvoorziening waaruit afnemers BRP-gegevens ontvangen.', 'reviewed', DATE '2026-10-28', 'Primaire bronpassage gecontroleerd. reviewed betekent broncontrole, geen juridische validatie of volledigheidsgarantie.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence` AS existing_seed_row ON existing_seed_row.code = 'c06_brpv_verstrekkingsvoorziening'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence` (code, statement, status, assessment_date, assessment_note)
SELECT 'c07_bag_adressen_gebouwen', 'De BAG bevat gegevens over adressen en gebouwen in Nederland.', 'reviewed', DATE '2026-10-28', 'Primaire bronpassage gecontroleerd. reviewed betekent broncontrole, geen juridische validatie of volledigheidsgarantie.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence` AS existing_seed_row ON existing_seed_row.code = 'c07_bag_adressen_gebouwen'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence` (code, statement, status, assessment_date, assessment_note)
SELECT 'c08_lv_bag_landelijke_voorziening', 'LV-BAG is de landelijke voorziening waarmee BAG-gegevens centraal beschikbaar worden gesteld.', 'reviewed', DATE '2026-10-28', 'Primaire bronpassage gecontroleerd. reviewed betekent broncontrole, geen juridische validatie of volledigheidsgarantie.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence` AS existing_seed_row ON existing_seed_row.code = 'c08_lv_bag_landelijke_voorziening'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence` (code, statement, status, assessment_date, assessment_note)
SELECT 'c09_mijnoverheid_functies', 'MijnOverheid biedt toegang tot digitale post, zaakstatusinformatie en persoonlijke gegevens van aangesloten organisaties.', 'reviewed', DATE '2026-10-28', 'Primaire bronpassage gecontroleerd. reviewed betekent broncontrole, geen juridische validatie of volledigheidsgarantie.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence` AS existing_seed_row ON existing_seed_row.code = 'c09_mijnoverheid_functies'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence` (code, statement, status, assessment_date, assessment_note)
SELECT 'c10_logius_biedt_digid', 'Logius biedt de publieke voorziening DigiD aan.', 'reviewed', DATE '2026-10-28', 'Primaire bronpassage gecontroleerd. reviewed betekent broncontrole, geen juridische validatie of volledigheidsgarantie.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence` AS existing_seed_row ON existing_seed_row.code = 'c10_logius_biedt_digid'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence` (code, statement, status, assessment_date, assessment_note)
SELECT 'c11_logius_beheert_mijnoverheid', 'Logius voert het beheer van MijnOverheid uit.', 'reviewed', DATE '2026-10-28', 'Primaire bronpassage gecontroleerd. reviewed betekent broncontrole, geen juridische validatie of volledigheidsgarantie.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence` AS existing_seed_row ON existing_seed_row.code = 'c11_logius_beheert_mijnoverheid'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence` (code, statement, status, assessment_date, assessment_note)
SELECT 'c12_rvig_niet_ingezetenen', 'RvIG is verantwoordelijk voor de persoonsgegevens van niet-ingezetenen binnen de BRP.', 'reviewed', DATE '2026-10-28', 'Primaire bronpassage gecontroleerd. reviewed betekent broncontrole, geen juridische validatie of volledigheidsgarantie.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence` AS existing_seed_row ON existing_seed_row.code = 'c12_rvig_niet_ingezetenen'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence` (code, statement, status, assessment_date, assessment_note)
SELECT 'c13_gemeenten_brp_bijhouding', 'Gemeenten beheren de BRP-gegevens van hun inwoners in eigen computersystemen.', 'reviewed', DATE '2026-10-28', 'Primaire bronpassage gecontroleerd. reviewed betekent broncontrole, geen juridische validatie of volledigheidsgarantie.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence` AS existing_seed_row ON existing_seed_row.code = 'c13_gemeenten_brp_bijhouding'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence` (code, statement, status, assessment_date, assessment_note)
SELECT 'c14_brpv_kopie', 'Een kopie van de door gemeenten bijgehouden persoonsgegevens wordt opgenomen in BRP-V.', 'reviewed', DATE '2026-10-28', 'Primaire bronpassage gecontroleerd. reviewed betekent broncontrole, geen juridische validatie of volledigheidsgarantie.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence` AS existing_seed_row ON existing_seed_row.code = 'c14_brpv_kopie'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence` (code, statement, status, assessment_date, assessment_note)
SELECT 'c15_gemeenten_bag_bronhouders', 'Gemeenten zijn bronhouders van de BAG en verantwoordelijk voor de opname en kwaliteit van hun gegevens.', 'reviewed', DATE '2026-10-28', 'Primaire bronpassage gecontroleerd. reviewed betekent broncontrole, geen juridische validatie of volledigheidsgarantie.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence` AS existing_seed_row ON existing_seed_row.code = 'c15_gemeenten_bag_bronhouders'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence` (code, statement, status, assessment_date, assessment_note)
SELECT 'c16_lv_bag_verstrekking', 'Het Kadaster stelt BAG-gegevens via LV-BAG beschikbaar aan afnemers.', 'reviewed', DATE '2026-10-28', 'Primaire bronpassage gecontroleerd. reviewed betekent broncontrole, geen juridische validatie of volledigheidsgarantie.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence` AS existing_seed_row ON existing_seed_row.code = 'c16_lv_bag_verstrekking'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence` (code, statement, status, assessment_date, assessment_note)
SELECT 'c17_mijnoverheid_toegang_digid', 'Gebruikers kunnen via DigiD toegang krijgen tot MijnOverheid.', 'reviewed', DATE '2026-10-28', 'Primaire bronpassage gecontroleerd. reviewed betekent broncontrole, geen juridische validatie of volledigheidsgarantie. De claim noemt een ondersteunde toegangsmethode, niet exclusiviteit en niet de inhoud of route van een operationele gegevensstroom.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence` AS existing_seed_row ON existing_seed_row.code = 'c17_mijnoverheid_toegang_digid'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence` (code, statement, status, assessment_date, assessment_note)
SELECT 'c18_mijnoverheid_toont_brp', 'MijnOverheid kan gebruikers hun registratie in de BRP tonen.', 'reviewed', DATE '2026-10-28', 'Primaire bronpassage gecontroleerd. reviewed betekent broncontrole, geen juridische validatie of volledigheidsgarantie.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence` AS existing_seed_row ON existing_seed_row.code = 'c18_mijnoverheid_toont_brp'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence` (code, statement, status, assessment_date, assessment_note)
SELECT 'c19_mijnoverheid_digikoppeling', 'MijnOverheid gebruikt Digikoppeling-standaarden voor gegevensuitwisseling.', 'reviewed', DATE '2026-10-28', 'Primaire bronpassage gecontroleerd. reviewed betekent broncontrole, geen juridische validatie of volledigheidsgarantie.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence` AS existing_seed_row ON existing_seed_row.code = 'c19_mijnoverheid_digikoppeling'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence` (code, statement, status, assessment_date, assessment_note)
SELECT 'c20_bag_api_rest', 'De BAG API Individuele Bevragingen biedt een RESTful interface voor gegevens uit LV-BAG.', 'reviewed', DATE '2026-10-28', 'Primaire bronpassage gecontroleerd. reviewed betekent broncontrole, geen juridische validatie of volledigheidsgarantie. De reikwijdte is uitsluitend BAG API Individuele Bevragingen; dit is geen uitspraak over alle onderdelen van LV-BAG.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence` AS existing_seed_row ON existing_seed_row.code = 'c20_bag_api_rest'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence` (code, statement, status, assessment_date, assessment_note)
SELECT 'c21_operatie_brp_programma', 'Operatie BRP was een programma met ontwikkelwerkzaamheden en een afzonderlijke ontwikkelorganisatie.', 'reviewed', DATE '2026-10-28', 'Primaire bronpassage gecontroleerd. reviewed betekent broncontrole, geen juridische validatie of volledigheidsgarantie. Het historische moderniseringsdoel betreft nieuwe BRP-voorzieningen; dit bewijst geen gerealiseerde software-livegang.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence` AS existing_seed_row ON existing_seed_row.code = 'c21_operatie_brp_programma'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence` (code, statement, status, assessment_date, assessment_note)
SELECT 'c22_digid_lancering_2005', 'DigiD is op 1 januari 2005 gelanceerd als authenticatiesysteem voor overheidsorganisaties.', 'reviewed', DATE '2026-10-28', 'Primaire bronpassage gecontroleerd. reviewed betekent broncontrole, geen juridische validatie of volledigheidsgarantie. Lancering wordt onderscheiden van eerdere voorbereiding en naamgeving.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence` AS existing_seed_row ON existing_seed_row.code = 'c22_digid_lancering_2005'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence` (code, statement, status, assessment_date, assessment_note)
SELECT 'c23_wet_brp_2014', 'De Wet BRP is op 6 januari 2014 ingevoerd; tegelijkertijd is de RNI geintroduceerd.', 'reviewed', DATE '2026-10-28', 'Primaire bronpassage gecontroleerd. reviewed betekent broncontrole, geen juridische validatie of volledigheidsgarantie. Wettelijke inwerkingtreding wordt onderscheiden van de ingebruikname van individuele systemen.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence` AS existing_seed_row ON existing_seed_row.code = 'c23_wet_brp_2014'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence` (code, statement, status, assessment_date, assessment_note)
SELECT 'c24_operatie_brp_stop_2017', 'Operatie BRP is in 2017 gestopt en in de tweede helft van dat jaar afgebouwd.', 'reviewed', DATE '2026-10-28', 'Primaire bronpassage gecontroleerd. reviewed betekent broncontrole, geen juridische validatie of volledigheidsgarantie. Alleen jaarprecisie gemodelleerd. De programma-stop is geen beeindiging van de BRP-registratie.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence` AS existing_seed_row ON existing_seed_row.code = 'c24_operatie_brp_stop_2017'
WHERE existing_seed_row.id IS NULL;

-- evidence_sources
INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_01_c01_s1', (SELECT id FROM evidence WHERE code = 'c01_logius_onderdeel_bzk'), (SELECT id FROM sources WHERE code = 's1_logius_digid_gegevens'), 'Managementsamenvatting: alinea over de minister als verwerkingsverantwoordelijke en Logius als onderdeel van BZK.', 'supports', 'Onderbouwt de bestuurlijke inbedding van Logius; geen ingangsdatum van de relatie.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_01_c01_s1'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_02_c02_s4', (SELECT id FROM evidence WHERE code = 'c02_rvig_naam'), (SELECT id FROM sources WHERE code = 's4_rvig_brp_beheer'), 'Eerste alinea: de volledige organisatienaam en afkorting RvIG.', 'supports', NULL
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_02_c02_s4'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_03_c03_s6', (SELECT id FROM evidence WHERE code = 'c03_kadaster_beheert_lv_bag'), (SELECT id FROM sources WHERE code = 's6_kadaster_over_bag'), 'Kadaster beheert LV-BAG: eerste zin.', 'supports', 'De bron benoemt beheer, niet alle afzonderlijke technische of juridische rollen.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_03_c03_s6'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_04_c04_s1', (SELECT id FROM evidence WHERE code = 'c04_digid_authenticatie'), (SELECT id FROM sources WHERE code = 's1_logius_digid_gegevens'), 'Managementsamenvatting: eerste alinea over elektronische authenticatie.', 'supports', NULL
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_04_c04_s1'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_05_c05_s4', (SELECT id FROM evidence WHERE code = 'c05_brp_ingezetenen_niet_ingezetenen'), (SELECT id FROM sources WHERE code = 's4_rvig_brp_beheer'), 'Eerste alinea: gegevens van inwoners en verantwoordelijkheid voor niet-ingezetenen.', 'supports', NULL
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_05_c05_s4'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_06_c05_s5', (SELECT id FROM evidence WHERE code = 'c05_brp_ingezetenen_niet_ingezetenen'), (SELECT id FROM sources WHERE code = 's5_rvig_brpv_adhoc'), 'Ook niet-ingezetenen maken deel uit van de BRP: eerste alinea en uitleg over RNI als onderdeel van BRP.', 'supports', NULL
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_06_c05_s5'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_07_c05_s5', (SELECT id FROM evidence WHERE code = 'c05_brp_ingezetenen_niet_ingezetenen'), (SELECT id FROM sources WHERE code = 's5_rvig_brpv_adhoc'), 'De ad-hoc-vraag: vereiste autorisatie voor identificerende en gevraagde gegevens.', 'qualifies', 'Onderbouwt de toegangsbeperking; geen toestemming voor iedere organisatie of gebruiker.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_07_c05_s5'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_08_c06_s4', (SELECT id FROM evidence WHERE code = 'c06_brpv_verstrekkingsvoorziening'), (SELECT id FROM sources WHERE code = 's4_rvig_brp_beheer'), 'Gemeenten beheren de gegevens van hun inwoners: laatste alinea over BRP-V en verstrekkingen.', 'supports', NULL
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_08_c06_s4'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_09_c07_s6', (SELECT id FROM evidence WHERE code = 'c07_bag_adressen_gebouwen'), (SELECT id FROM sources WHERE code = 's6_kadaster_over_bag'), 'Over BAG: eerste alinea.', 'supports', NULL
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_09_c07_s6'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_10_c08_s6', (SELECT id FROM evidence WHERE code = 'c08_lv_bag_landelijke_voorziening'), (SELECT id FROM sources WHERE code = 's6_kadaster_over_bag'), 'Gemeenten zijn verantwoordelijk - bronhouders BAG: centraal beschikbaar stellen via LV-BAG.', 'supports', NULL
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_10_c08_s6'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_11_c09_s3', (SELECT id FROM evidence WHERE code = 'c09_mijnoverheid_functies'), (SELECT id FROM sources WHERE code = 's3_mijnoverheid_werking'), 'Inleiding en Onderdelen MijnOverheid: Berichtenbox, Persoonlijke Gegevens en Lopende Zaken.', 'supports', 'Beschrijft aangeboden functies, geen compleet dossier van alle overheidsorganisaties.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_11_c09_s3'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_12_c10_s1', (SELECT id FROM evidence WHERE code = 'c10_logius_biedt_digid'), (SELECT id FROM sources WHERE code = 's1_logius_digid_gegevens'), 'Managementsamenvatting: alinea die Logius als aanbieder van DigiD benoemt.', 'supports', NULL
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_12_c10_s1'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_13_c11_s2', (SELECT id FROM evidence WHERE code = 'c11_logius_beheert_mijnoverheid'), (SELECT id FROM sources WHERE code = 's2_mijnoverheid_privacy'), '1. Wie is verantwoordelijk voor de verwerking van de persoonsgegevens?: beheer door Logius.', 'supports', NULL
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_13_c11_s2'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_14_c12_s4', (SELECT id FROM evidence WHERE code = 'c12_rvig_niet_ingezetenen'), (SELECT id FROM sources WHERE code = 's4_rvig_brp_beheer'), 'Eerste alinea: verantwoordelijkheid van RvIG voor gegevens van niet-ingezetenen.', 'supports', 'Scope is uitsluitend het deel niet-ingezetenen; gemeenten houden de gegevens van hun inwoners bij.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_14_c12_s4'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_15_c13_s4', (SELECT id FROM evidence WHERE code = 'c13_gemeenten_brp_bijhouding'), (SELECT id FROM sources WHERE code = 's4_rvig_brp_beheer'), 'Gemeenten beheren de gegevens van hun inwoners: eigen computersysteem.', 'supports', 'Geen fictieve verzamelorganisatie voor alle gemeenten aangemaakt.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_15_c13_s4'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_16_c14_s4', (SELECT id FROM evidence WHERE code = 'c14_brpv_kopie'), (SELECT id FROM sources WHERE code = 's4_rvig_brp_beheer'), 'Gemeenten beheren de gegevens van hun inwoners: kopie in BRP-V.', 'supports', 'Geen transportprotocol of synchronisatiefrequentie in deze passage.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_16_c14_s4'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_17_c15_s6', (SELECT id FROM evidence WHERE code = 'c15_gemeenten_bag_bronhouders'), (SELECT id FROM sources WHERE code = 's6_kadaster_over_bag'), 'Gemeenten zijn verantwoordelijk - bronhouders BAG: verantwoordelijkheid voor opname en kwaliteit.', 'supports', 'Geen afzonderlijke gemeente of softwareleverancier uit deze generieke uitleg afgeleid.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_17_c15_s6'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_18_c16_s6', (SELECT id FROM evidence WHERE code = 'c16_lv_bag_verstrekking'), (SELECT id FROM sources WHERE code = 's6_kadaster_over_bag'), 'Kadaster beheert LV-BAG: beschikbaar stellen aan afnemers.', 'supports', NULL
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_18_c16_s6'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_19_c17_s3', (SELECT id FROM evidence WHERE code = 'c17_mijnoverheid_toegang_digid'), (SELECT id FROM sources WHERE code = 's3_mijnoverheid_werking'), 'Inleiding: toegang tot MijnOverheid met DigiD.', 'supports', 'Ondersteunde loginrelatie; geen exclusiviteitsclaim en geen data_flow-record.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_19_c17_s3'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_20_c18_s3', (SELECT id FROM evidence WHERE code = 'c18_mijnoverheid_toont_brp'), (SELECT id FROM sources WHERE code = 's3_mijnoverheid_werking'), 'Persoonlijke gegevens: voorbeeld Registratie in de Basisregistratie Personen.', 'supports', 'De precieze verbinding met BRP-V en de opslagwijze staan niet in deze passage.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_20_c18_s3'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_21_c19_s3', (SELECT id FROM evidence WHERE code = 'c19_mijnoverheid_digikoppeling'), (SELECT id FROM sources WHERE code = 's3_mijnoverheid_werking'), 'Betrouwbaar en veilig: gegevensuitwisseling met Digikoppeling-standaarden.', 'supports', 'Geen versie of volledige dekking van alle MijnOverheid-verbindingen afgeleid.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_21_c19_s3'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_22_c20_s7', (SELECT id FROM evidence WHERE code = 'c20_bag_api_rest'), (SELECT id FROM sources WHERE code = 's7_kadaster_bag_api'), 'Productkenmerken en Rechtstreeks bevragen van BAG gegevens van 1 of enkele objecten.', 'supports', 'De productkenmerken noemen RESTful en JSON; de vervolgtekst noemt actuele en historische gegevens uit LV-BAG.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_22_c20_s7'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_23_c21_s9', (SELECT id FROM evidence WHERE code = 'c21_operatie_brp_programma'), (SELECT id FROM sources WHERE code = 's9_bzk_jaarverslag_2017'), '6.5 Reisdocumenten en basisadministratie personen > Opdrachten > Operatie Basisregistratie personen (BRP).', 'supports', 'Onderbouwt het programma en de afzonderlijke ontwikkelorganisatie.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_23_c21_s9'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_24_c21_s9', (SELECT id FROM evidence WHERE code = 'c21_operatie_brp_programma'), (SELECT id FROM sources WHERE code = 's9_bzk_jaarverslag_2017'), 'Jaarverantwoording RvIG > Balans > Overige materiele activa t.b.v. oBRP.', 'qualifies', 'Beschrijft de samenwerking voor nieuwe voorzieningen en migratie; het moderniseringsdoel is historisch, geen gerealiseerde livegang.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_24_c21_s9'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_25_c22_s8', (SELECT id FROM evidence WHERE code = 'c22_digid_lancering_2005'), (SELECT id FROM sources WHERE code = 's8_kamerstuk_digid_lancering'), '7. DigiD: eerste zin over de lancering op 1 januari 2005.', 'supports', NULL
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_25_c22_s8'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_26_c23_s5', (SELECT id FROM evidence WHERE code = 'c23_wet_brp_2014'), (SELECT id FROM sources WHERE code = 's5_rvig_brpv_adhoc'), 'Ook niet-ingezetenen maken deel uit van de BRP: eerste zin over Wet BRP en RNI.', 'supports', NULL
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_26_c23_s5'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `evidence_sources` (code, evidence_id, source_id, claim_locator, relation_kind, support_note)
SELECT 'es_27_c24_s9', (SELECT id FROM evidence WHERE code = 'c24_operatie_brp_stop_2017'), (SELECT id FROM sources WHERE code = 's9_bzk_jaarverslag_2017'), 'Artikel 6 > C Beleidsconclusies > Operatie BRP; 6.5 > Opdrachten > Operatie Basisregistratie personen (BRP).', 'supports', 'De bron noemt juli 2017 en afbouw in de tweede helft van 2017; deze seed gebruikt bewust alleen jaarprecisie.'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `evidence_sources` AS existing_seed_row ON existing_seed_row.code = 'es_27_c24_s9'
WHERE existing_seed_row.id IS NULL;

-- organizations
INSERT INTO `organizations` (code, name, description, organization_kind, evidence_id, observed_on)
SELECT 'bzk', 'Ministerie van Binnenlandse Zaken en Koninkrijksrelaties', 'Ministerie waarvan Logius volgens de bron onderdeel is.', 'ministry', (SELECT id FROM evidence WHERE code = 'c01_logius_onderdeel_bzk'), DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `organizations` AS existing_seed_row ON existing_seed_row.code = 'bzk'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `organizations` (code, name, description, organization_kind, evidence_id, observed_on)
SELECT 'logius', 'Logius', 'Publieke dienst die DigiD aanbiedt en MijnOverheid beheert; de bestuurlijke inbedding wordt afzonderlijk vastgelegd.', 'agency', (SELECT id FROM evidence WHERE code = 'c01_logius_onderdeel_bzk'), DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `organizations` AS existing_seed_row ON existing_seed_row.code = 'logius'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `organizations` (code, name, description, organization_kind, evidence_id, observed_on)
SELECT 'rvig', 'Rijksdienst voor Identiteitsgegevens', 'Overheidsorganisatie die in de gebruikte BRP-bron verantwoordelijk is voor de gegevens van niet-ingezetenen.', 'agency', (SELECT id FROM evidence WHERE code = 'c02_rvig_naam'), DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `organizations` AS existing_seed_row ON existing_seed_row.code = 'rvig'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `organizations` (code, name, description, organization_kind, evidence_id, observed_on)
SELECT 'kadaster', 'Kadaster', 'Organisatie die LV-BAG beheert en via deze voorziening BAG-gegevens beschikbaar stelt.', 'other_public_body', (SELECT id FROM evidence WHERE code = 'c03_kadaster_beheert_lv_bag'), DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `organizations` AS existing_seed_row ON existing_seed_row.code = 'kadaster'
WHERE existing_seed_row.id IS NULL;

-- public_functions
INSERT INTO `public_functions` (code, name, description, function_kind, parent_function_id, evidence_id, observed_on)
SELECT 'digitale_authenticatie', 'Digitale authenticatie', 'Een gebruiker online laten authentiseren bij een aangesloten dienstverlener.', 'service', NULL, (SELECT id FROM evidence WHERE code = 'c04_digid_authenticatie'), DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `public_functions` AS existing_seed_row ON existing_seed_row.code = 'digitale_authenticatie'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `public_functions` (code, name, description, function_kind, parent_function_id, evidence_id, observed_on)
SELECT 'bag_gegevens_bevragen', 'BAG-gegevens bevragen', 'Via BAG API Individuele Bevragingen actuele en historische gegevens van een of enkele BAG-objecten opvragen.', 'service', NULL, (SELECT id FROM evidence WHERE code = 'c20_bag_api_rest'), DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `public_functions` AS existing_seed_row ON existing_seed_row.code = 'bag_gegevens_bevragen'
WHERE existing_seed_row.id IS NULL;

-- digital_systems
INSERT INTO `digital_systems` (code, name, description, system_kind, lifecycle_status, evidence_id, observed_on)
SELECT 'digid', 'DigiD', 'Elektronische authenticatievoorziening voor gebruikers bij aangesloten dienstverleners.', 'authentication', 'operational', (SELECT id FROM evidence WHERE code = 'c04_digid_authenticatie'), DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `digital_systems` AS existing_seed_row ON existing_seed_row.code = 'digid'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `digital_systems` (code, name, description, system_kind, lifecycle_status, evidence_id, observed_on)
SELECT 'brp_v', 'Basisregistratie Personen Verstrekkingsvoorziening (BRP-V)', 'Voorziening waaruit afnemers persoonsgegevens uit de BRP ontvangen; afzonderlijk van de registratie BRP.', 'registry_service', 'operational', (SELECT id FROM evidence WHERE code = 'c06_brpv_verstrekkingsvoorziening'), DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `digital_systems` AS existing_seed_row ON existing_seed_row.code = 'brp_v'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `digital_systems` (code, name, description, system_kind, lifecycle_status, evidence_id, observed_on)
SELECT 'mijnoverheid', 'MijnOverheid', 'Portaal met onder meer digitale post, zaakstatussen en persoonlijke gegevens van aangesloten organisaties.', 'portal', 'operational', (SELECT id FROM evidence WHERE code = 'c09_mijnoverheid_functies'), DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `digital_systems` AS existing_seed_row ON existing_seed_row.code = 'mijnoverheid'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `digital_systems` (code, name, description, system_kind, lifecycle_status, evidence_id, observed_on)
SELECT 'lv_bag', 'Landelijke Voorziening BAG (LV-BAG)', 'Landelijke voorziening voor het beschikbaar stellen van BAG-gegevens, beheerd door het Kadaster.', 'registry_service', 'operational', (SELECT id FROM evidence WHERE code = 'c08_lv_bag_landelijke_voorziening'), DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `digital_systems` AS existing_seed_row ON existing_seed_row.code = 'lv_bag'
WHERE existing_seed_row.id IS NULL;

-- datasets
INSERT INTO `datasets` (code, name, description, dataset_kind, access_classification, lifecycle_status, evidence_id, observed_on)
SELECT 'brp', 'Basisregistratie Personen (BRP)', 'Registratie met persoonsgegevens van ingezetenen en niet-ingezetenen. De seed bevat alleen metadata; gegevensverstrekking vereist autorisatie.', 'base_register', 'restricted', 'operational', (SELECT id FROM evidence WHERE code = 'c05_brp_ingezetenen_niet_ingezetenen'), DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `datasets` AS existing_seed_row ON existing_seed_row.code = 'brp'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `datasets` (code, name, description, dataset_kind, access_classification, lifecycle_status, evidence_id, observed_on)
SELECT 'bag', 'Basisregistratie Adressen en Gebouwen (BAG)', 'Registratie met gegevens over adressen en gebouwen. De brononderbouwing in deze seed stelt de volledige toegangsclassificatie niet vast.', 'base_register', 'unknown', 'operational', (SELECT id FROM evidence WHERE code = 'c07_bag_adressen_gebouwen'), DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `datasets` AS existing_seed_row ON existing_seed_row.code = 'bag'
WHERE existing_seed_row.id IS NULL;

-- technologies
INSERT INTO `technologies` (code, name, description, technology_kind, evidence_id, observed_on)
SELECT 'rest', 'REST', 'Architectuurstijl voor API-interfaces; de Kadasterbron benoemt BAG API Individuele Bevragingen als RESTful.', 'architecture', (SELECT id FROM evidence WHERE code = 'c20_bag_api_rest'), DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `technologies` AS existing_seed_row ON existing_seed_row.code = 'rest'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `technologies` (code, name, description, technology_kind, evidence_id, observed_on)
SELECT 'digikoppeling', 'Digikoppeling', 'Uitwisselingsstandaarden die MijnOverheid volgens Logius gebruikt; er is geen versie in deze seed vastgesteld.', 'standard', (SELECT id FROM evidence WHERE code = 'c19_mijnoverheid_digikoppeling'), DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `technologies` AS existing_seed_row ON existing_seed_row.code = 'digikoppeling'
WHERE existing_seed_row.id IS NULL;

-- programmes
INSERT INTO `programmes` (code, name, description, programme_kind, lifecycle_status, evidence_id, observed_on)
SELECT 'operatie_brp', 'Operatie BRP', 'Historisch programma voor nieuwe voorzieningen rond de BRP, met een afzonderlijke ontwikkelorganisatie. Het programma werd in 2017 gestopt; de BRP-registratie is een aparte entiteit.', 'programme', 'stopped', (SELECT id FROM evidence WHERE code = 'c21_operatie_brp_programma'), DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `programmes` AS existing_seed_row ON existing_seed_row.code = 'operatie_brp'
WHERE existing_seed_row.id IS NULL;

-- historical_events
INSERT INTO `historical_events` (code, title, description, event_kind, earliest_date, latest_date, date_precision, date_label, evidence_id, observed_on)
SELECT 'digid_lancering_2005', 'Lancering DigiD', 'Lancering van DigiD als authenticatiesysteem voor overheidsorganisaties; eerdere voorbereiding en naamgeving vallen buiten deze gebeurtenis.', 'launch', DATE '2005-01-01', DATE '2005-01-01', 'exact_day', '1 januari 2005', (SELECT id FROM evidence WHERE code = 'c22_digid_lancering_2005'), DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `historical_events` AS existing_seed_row ON existing_seed_row.code = 'digid_lancering_2005'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `historical_events` (code, title, description, event_kind, earliest_date, latest_date, date_precision, date_label, evidence_id, observed_on)
SELECT 'wet_brp_inwerking_2014', 'Inwerkingtreding Wet BRP', 'Inwerkingtreding van de Wet BRP en introductie van de RNI. Dit is geen datum waarop alle technische BRP-voorzieningen voor het eerst zijn gestart.', 'change', DATE '2014-01-06', DATE '2014-01-06', 'exact_day', '6 januari 2014', (SELECT id FROM evidence WHERE code = 'c23_wet_brp_2014'), DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `historical_events` AS existing_seed_row ON existing_seed_row.code = 'wet_brp_inwerking_2014'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `historical_events` (code, title, description, event_kind, earliest_date, latest_date, date_precision, date_label, evidence_id, observed_on)
SELECT 'operatie_brp_stop_2017', 'Stopzetting Operatie BRP', 'Stopzetting en afbouw van het ontwikkelprogramma Operatie BRP in 2017; geen beeindiging van de BRP-registratie.', 'termination', DATE '2017-01-01', DATE '2017-12-31', 'year', '2017', (SELECT id FROM evidence WHERE code = 'c24_operatie_brp_stop_2017'), DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `historical_events` AS existing_seed_row ON existing_seed_row.code = 'operatie_brp_stop_2017'
WHERE existing_seed_row.id IS NULL;

-- organization_relations
INSERT INTO `organization_relations` (code, from_organization_id, to_organization_id, relation_kind, notes, evidence_id, valid_from, valid_until, observed_on)
SELECT 'logius_onderdeel_bzk', (SELECT id FROM organizations WHERE code = 'logius'), (SELECT id FROM organizations WHERE code = 'bzk'), 'administrative_part_of', 'Bron S1 noemt Logius als onderdeel van BZK. Historische begin- en einddatum zijn niet vastgesteld.', (SELECT id FROM evidence WHERE code = 'c01_logius_onderdeel_bzk'), NULL, NULL, DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `organization_relations` AS existing_seed_row ON existing_seed_row.code = 'logius_onderdeel_bzk'
WHERE existing_seed_row.id IS NULL;

-- system_responsibilities
INSERT INTO `system_responsibilities` (code, organization_id, system_id, responsibility_role, notes, evidence_id, valid_from, valid_until, observed_on)
SELECT 'logius_digid_aanbieder', (SELECT id FROM organizations WHERE code = 'logius'), (SELECT id FROM digital_systems WHERE code = 'digid'), 'provider', 'De bron noemt Logius als aanbieder van DigiD. Dit is geen volledige inventaris van technische onderaannemers of eigendomsrechten.', (SELECT id FROM evidence WHERE code = 'c10_logius_biedt_digid'), NULL, NULL, DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `system_responsibilities` AS existing_seed_row ON existing_seed_row.code = 'logius_digid_aanbieder'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `system_responsibilities` (code, organization_id, system_id, responsibility_role, notes, evidence_id, valid_from, valid_until, observed_on)
SELECT 'logius_mijnoverheid_beheer', (SELECT id FROM organizations WHERE code = 'logius'), (SELECT id FROM digital_systems WHERE code = 'mijnoverheid'), 'service_manager', 'Beheer van de voorziening MijnOverheid, zoals benoemd in de privacyverklaring; geen gelijkstelling aan juridisch eigendom of alle aansluitingen.', (SELECT id FROM evidence WHERE code = 'c11_logius_beheert_mijnoverheid'), NULL, NULL, DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `system_responsibilities` AS existing_seed_row ON existing_seed_row.code = 'logius_mijnoverheid_beheer'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `system_responsibilities` (code, organization_id, system_id, responsibility_role, notes, evidence_id, valid_from, valid_until, observed_on)
SELECT 'kadaster_lv_bag_beheer', (SELECT id FROM organizations WHERE code = 'kadaster'), (SELECT id FROM digital_systems WHERE code = 'lv_bag'), 'service_manager', 'De bron noemt beheer van LV-BAG. Gemeenten blijven de bronhouders van BAG-gegevens.', (SELECT id FROM evidence WHERE code = 'c03_kadaster_beheert_lv_bag'), NULL, NULL, DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `system_responsibilities` AS existing_seed_row ON existing_seed_row.code = 'kadaster_lv_bag_beheer'
WHERE existing_seed_row.id IS NULL;

-- dataset_responsibilities
INSERT INTO `dataset_responsibilities` (code, organization_id, dataset_id, responsibility_role, notes, evidence_id, valid_from, valid_until, observed_on)
SELECT 'rvig_brp_niet_ingezetenen', (SELECT id FROM organizations WHERE code = 'rvig'), (SELECT id FROM datasets WHERE code = 'brp'), 'other', 'UITSLUITEND DEELVERZAMELING NIET-INGEZETENEN. De bron noemt RvIG verantwoordelijk voor deze persoonsgegevens; geen exclusieve bronhouder- of beheerdersrol voor de gehele BRP. Gemeenten beheren de gegevens van hun inwoners.', (SELECT id FROM evidence WHERE code = 'c12_rvig_niet_ingezetenen'), NULL, NULL, DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `dataset_responsibilities` AS existing_seed_row ON existing_seed_row.code = 'rvig_brp_niet_ingezetenen'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `dataset_responsibilities` (code, organization_id, dataset_id, responsibility_role, notes, evidence_id, valid_from, valid_until, observed_on)
SELECT 'kadaster_bag_verstrekker', (SELECT id FROM organizations WHERE code = 'kadaster'), (SELECT id FROM datasets WHERE code = 'bag'), 'distributor', 'Verstrekking van BAG-gegevens via LV-BAG. Dit maakt het Kadaster niet tot gemeentelijk bronhouder.', (SELECT id FROM evidence WHERE code = 'c16_lv_bag_verstrekking'), NULL, NULL, DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `dataset_responsibilities` AS existing_seed_row ON existing_seed_row.code = 'kadaster_bag_verstrekker'
WHERE existing_seed_row.id IS NULL;

-- system_dataset_usage
INSERT INTO `system_dataset_usage` (code, system_id, dataset_id, usage_role, notes, evidence_id, valid_from, valid_until, observed_on)
SELECT 'brp_v_bewaren_brp_kopie', (SELECT id FROM digital_systems WHERE code = 'brp_v'), (SELECT id FROM datasets WHERE code = 'brp'), 'stores', 'Kopie van door gemeenten bijgehouden persoonsgegevens. Geen protocol of synchronisatiefrequentie vastgesteld.', (SELECT id FROM evidence WHERE code = 'c14_brpv_kopie'), NULL, NULL, DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `system_dataset_usage` AS existing_seed_row ON existing_seed_row.code = 'brp_v_bewaren_brp_kopie'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `system_dataset_usage` (code, system_id, dataset_id, usage_role, notes, evidence_id, valid_from, valid_until, observed_on)
SELECT 'brp_v_verstrekken_brp', (SELECT id FROM digital_systems WHERE code = 'brp_v'), (SELECT id FROM datasets WHERE code = 'brp'), 'serves', 'Verstrekkingsfunctie voor afnemers; gegevensverstrekking is aan autorisatie gebonden.', (SELECT id FROM evidence WHERE code = 'c06_brpv_verstrekkingsvoorziening'), NULL, NULL, DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `system_dataset_usage` AS existing_seed_row ON existing_seed_row.code = 'brp_v_verstrekken_brp'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `system_dataset_usage` (code, system_id, dataset_id, usage_role, notes, evidence_id, valid_from, valid_until, observed_on)
SELECT 'lv_bag_verstrekken_bag', (SELECT id FROM digital_systems WHERE code = 'lv_bag'), (SELECT id FROM datasets WHERE code = 'bag'), 'serves', 'BAG-gegevens beschikbaar stellen via de landelijke voorziening; geen benoemde ontvangende toepassing uit deze bron afgeleid.', (SELECT id FROM evidence WHERE code = 'c16_lv_bag_verstrekking'), NULL, NULL, DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `system_dataset_usage` AS existing_seed_row ON existing_seed_row.code = 'lv_bag_verstrekken_bag'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `system_dataset_usage` (code, system_id, dataset_id, usage_role, notes, evidence_id, valid_from, valid_until, observed_on)
SELECT 'mijnoverheid_inzage_brp', (SELECT id FROM digital_systems WHERE code = 'mijnoverheid'), (SELECT id FROM datasets WHERE code = 'brp'), 'reads', 'Toont de eigen BRP-registratie aan gebruikers. De bron specificeert niet de technische route vanaf BRP-V of de opslagwijze; daarom geen systeem-naar-systeemflow.', (SELECT id FROM evidence WHERE code = 'c18_mijnoverheid_toont_brp'), NULL, NULL, DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `system_dataset_usage` AS existing_seed_row ON existing_seed_row.code = 'mijnoverheid_inzage_brp'
WHERE existing_seed_row.id IS NULL;

-- system_technologies
INSERT INTO `system_technologies` (code, system_id, technology_id, usage_role, notes, evidence_id, valid_from, valid_until, observed_on)
SELECT 'mijnoverheid_digikoppeling', (SELECT id FROM digital_systems WHERE code = 'mijnoverheid'), (SELECT id FROM technologies WHERE code = 'digikoppeling'), 'uses', 'Scope: gegevensuitwisseling zoals beschreven door Logius. Geen versie vastgelegd; geen claim over iedere interne verbinding.', (SELECT id FROM evidence WHERE code = 'c19_mijnoverheid_digikoppeling'), NULL, NULL, DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `system_technologies` AS existing_seed_row ON existing_seed_row.code = 'mijnoverheid_digikoppeling'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `system_technologies` (code, system_id, technology_id, usage_role, notes, evidence_id, valid_from, valid_until, observed_on)
SELECT 'lv_bag_rest_individuele_bevragingen', (SELECT id FROM digital_systems WHERE code = 'lv_bag'), (SELECT id FROM technologies WHERE code = 'rest'), 'uses', 'UITSLUITEND BAG API INDIVIDUELE BEVRAGINGEN: RESTful interface voor actuele en historische gegevens uit LV-BAG. Geen claim dat alle LV-BAG-onderdelen REST gebruiken.', (SELECT id FROM evidence WHERE code = 'c20_bag_api_rest'), NULL, NULL, DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `system_technologies` AS existing_seed_row ON existing_seed_row.code = 'lv_bag_rest_individuele_bevragingen'
WHERE existing_seed_row.id IS NULL;

-- programme_targets
INSERT INTO `programme_targets` (code, programme_id, system_id, dataset_id, change_kind, notes, evidence_id, valid_from, valid_until, observed_on)
SELECT 'operatie_brp_modernisering_brp', (SELECT id FROM programmes WHERE code = 'operatie_brp'), NULL, (SELECT id FROM datasets WHERE code = 'brp'), 'modernizes', 'Historische moderniseringsdoelstelling voor de voorzieningen rond de registratie BRP. De bron beschrijft ontwikkeling, migratievoorbereiding en afbouw; geen voltooide modernisering, software-live-datum of beeindiging van de registratie wordt beweerd.', (SELECT id FROM evidence WHERE code = 'c21_operatie_brp_programma'), NULL, NULL, DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `programme_targets` AS existing_seed_row ON existing_seed_row.code = 'operatie_brp_modernisering_brp'
WHERE existing_seed_row.id IS NULL;

-- event_subjects
INSERT INTO `event_subjects` (code, event_id, system_id, dataset_id, programme_id, subject_role, notes, evidence_id, observed_on)
SELECT 'digid_lancering_onderwerp', (SELECT id FROM historical_events WHERE code = 'digid_lancering_2005'), (SELECT id FROM digital_systems WHERE code = 'digid'), NULL, NULL, 'subject', 'De datum heeft betrekking op de lancering van de authenticatievoorziening.', (SELECT id FROM evidence WHERE code = 'c22_digid_lancering_2005'), DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `event_subjects` AS existing_seed_row ON existing_seed_row.code = 'digid_lancering_onderwerp'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `event_subjects` (code, event_id, system_id, dataset_id, programme_id, subject_role, notes, evidence_id, observed_on)
SELECT 'wet_brp_onderwerp', (SELECT id FROM historical_events WHERE code = 'wet_brp_inwerking_2014'), NULL, (SELECT id FROM datasets WHERE code = 'brp'), NULL, 'subject', 'Wettelijke mijlpaal voor de registratie; niet als startdatum van BRP-V gemodelleerd.', (SELECT id FROM evidence WHERE code = 'c23_wet_brp_2014'), DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `event_subjects` AS existing_seed_row ON existing_seed_row.code = 'wet_brp_onderwerp'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `event_subjects` (code, event_id, system_id, dataset_id, programme_id, subject_role, notes, evidence_id, observed_on)
SELECT 'operatie_brp_stop_onderwerp', (SELECT id FROM historical_events WHERE code = 'operatie_brp_stop_2017'), NULL, NULL, (SELECT id FROM programmes WHERE code = 'operatie_brp'), 'subject', 'Alleen het programma is onderwerp van stopzetting; BRP en BRP-V worden niet beeindigd.', (SELECT id FROM evidence WHERE code = 'c24_operatie_brp_stop_2017'), DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `event_subjects` AS existing_seed_row ON existing_seed_row.code = 'operatie_brp_stop_onderwerp'
WHERE existing_seed_row.id IS NULL;

-- system_functions
INSERT INTO `system_functions` (code, system_id, function_id, usage_role, notes, evidence_id, valid_from, valid_until, observed_on)
SELECT 'digid_ondersteunt_authenticatie', (SELECT id FROM digital_systems WHERE code = 'digid'), (SELECT id FROM public_functions WHERE code = 'digitale_authenticatie'), 'supports', 'Ondersteunt elektronische authenticatie bij aangesloten dienstverleners. Dit verleent geen mandaat voor hun inhoudelijke besluiten.', (SELECT id FROM evidence WHERE code = 'c04_digid_authenticatie'), NULL, NULL, DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `system_functions` AS existing_seed_row ON existing_seed_row.code = 'digid_ondersteunt_authenticatie'
WHERE existing_seed_row.id IS NULL;

INSERT INTO `system_functions` (code, system_id, function_id, usage_role, notes, evidence_id, valid_from, valid_until, observed_on)
SELECT 'lv_bag_toegang_bevragingen', (SELECT id FROM digital_systems WHERE code = 'lv_bag'), (SELECT id FROM public_functions WHERE code = 'bag_gegevens_bevragen'), 'provides_access', 'Scope: BAG API Individuele Bevragingen voor een of enkele objecten. Geen bulkvoorziening en geen algemene bevoegdheid tot besluitvorming.', (SELECT id FROM evidence WHERE code = 'c20_bag_api_rest'), NULL, NULL, DATE '2026-10-28'
FROM (SELECT 1 AS seed_marker) AS seed_input
LEFT JOIN `system_functions` AS existing_seed_row ON existing_seed_row.code = 'lv_bag_toegang_bevragingen'
WHERE existing_seed_row.id IS NULL;

COMMIT;
SET @bestuursatlas_actor_id = NULL;

-- De bronvulling bevat 96 records, 24 uitspraken en 9 primaire bronnen.
-- Leeg: territories, mandates, data_flows, data_flow_datasets.
-- De RvIG-rol betreft uitsluitend niet-ingezetenen.
-- De REST-relatie bij LV-BAG betreft uitsluitend BAG API Individuele Bevragingen.
-- reviewed betekent broncontrole, geen automatische waarheidsverklaring.
-- audit_log wordt pas automatisch gevuld na installatie van 04_audit_optie.sql.

SELECT 'Bestuursatlas is geimporteerd. Open organizations of digital_systems via Verkennen.' AS klaar;
