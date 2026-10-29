<?php
declare(strict_types=1);

namespace Govern;

/** Application feedback only. SQL, catalog identifiers and stored text stay exact. */
final class Messages
{
    private const TEXT = [
        'host_not_allowed' => ['nl' => 'Deze hostnaam is niet toegestaan voor de lokale werkplek.', 'en' => 'This hostname is not allowed for the local workspace.'],
        'same_window_required' => ['nl' => 'Open de werkplek rechtstreeks in hetzelfde browservenster.', 'en' => 'Open the workspace directly in the same browser window.'],
        'origin_not_allowed' => ['nl' => 'Dit verzoek komt niet uit de eigen werkplek.', 'en' => 'This request did not come from this workspace.'],
        'session_unavailable' => ['nl' => 'De lokale browsersessie kan niet worden geopend.', 'en' => 'The local browser session could not be opened.'],
        'post_required' => ['nl' => 'Gebruik POST voor deze handeling.', 'en' => 'Use POST for this action.'],
        'csrf_invalid' => ['nl' => 'Vernieuw de pagina en probeer opnieuw; de browsersessie klopt niet meer.', 'en' => 'Refresh the page and try again; the browser session is no longer valid.'],
        'json_required' => ['nl' => 'Verstuur deze handeling als JSON.', 'en' => 'Send this action as JSON.'],
        'request_too_large' => ['nl' => 'Dit verzoek is te groot.', 'en' => 'This request is too large.'],
        'json_invalid' => ['nl' => 'De ontvangen gegevens zijn geen geldige JSON.', 'en' => 'The received data is not valid JSON.'],
        'json_object_required' => ['nl' => 'De ontvangen gegevens moeten een JSON-object zijn.', 'en' => 'The received data must be a JSON object.'],
        'get_required' => ['nl' => 'Gebruik GET om deze informatie te bekijken.', 'en' => 'Use GET to view this information.'],
        'text_invalid' => ['nl' => 'Vul een geldige tekst in voor {field}.', 'en' => 'Enter valid text for {field}.'],
        'field_required' => ['nl' => 'Vul {field} in.', 'en' => 'Enter {field}.'],
        'integer_invalid' => ['nl' => 'Vul een geldig getal in voor {field}.', 'en' => 'Enter a valid number for {field}.'],
        'port_invalid' => ['nl' => 'DB_PORT moet een geldig poortnummer zijn.', 'en' => 'DB_PORT must be a valid port number.'],
        'database_name_invalid' => ['nl' => 'DB_NAME is niet geldig ingesteld.', 'en' => 'DB_NAME is not configured correctly.'],
        'identifier_invalid' => ['nl' => 'Ongeldige naam voor een databaseobject.', 'en' => 'Invalid database object name.'],
        'reader_required' => ['nl' => 'Stel voor onderzoeken een afzonderlijke databasegebruiker met alleen leesrechten in.', 'en' => 'Configure a separate database user with read-only permissions for research.'],
        'credentials_missing' => ['nl' => 'De databasegegevens zijn nog niet ingesteld. Start Govern met het meegeleverde startscript.', 'en' => 'The database connection is not configured yet. Start Govern with the supplied start script.'],
        'backup_directory_unwritable' => ['nl' => 'De map voor herstelpunten is niet schrijfbaar.', 'en' => 'The restore point folder is not writable.'],
        'maintenance_lock_unavailable' => ['nl' => 'De werkplek kan de herstelvergrendeling niet openen.', 'en' => 'The workspace could not open the restore lock.'],
        'maintenance_busy' => ['nl' => 'Er wordt een herstelpunt gemaakt of teruggezet. Probeer het zo opnieuw.', 'en' => 'A restore point is being created or restored. Try again shortly.'],
        'page_too_large' => ['nl' => 'Dit paginanummer is te groot. Gebruik een filter om de gegevens te vinden.', 'en' => 'This page number is too large. Use a filter to find the data.'],
        'search_too_long' => ['nl' => 'De zoektekst is te lang. Gebruik maximaal 2048 bytes.', 'en' => 'The search text is too long. Use at most 2048 bytes.'],
        'search_not_supported' => ['nl' => 'Deze tabel heeft geen velden waarin tekst kan worden gezocht.', 'en' => 'This table has no fields that support text search.'],
        'table_missing' => ['nl' => 'Deze tabel of dit overzicht bestaat niet meer. Vernieuw de werkplek.', 'en' => 'This table or view no longer exists. Refresh the workspace.'],
        'browse_shortened' => ['nl' => 'De weergave is ingekort. De volledige waarden staan in phpMyAdmin.', 'en' => 'The preview has been shortened. The full values are available in phpMyAdmin.'],
        'preview_binary_shortened' => ['nl' => ' … [binaire weergave ingekort]', 'en' => ' … [binary preview shortened]'],
        'preview_shortened' => ['nl' => ' … [weergave ingekort]', 'en' => ' … [preview shortened]'],
        'sql_required' => ['nl' => 'Vul eerst een SQL-vraag in.', 'en' => 'Enter a SQL query first.'],
        'sql_delimiter_invalid' => ['nl' => 'Gebruik na DELIMITER een scheidingsteken van maximaal 32 tekens, zonder spaties, aanhalingstekens of backslashes.', 'en' => 'Use a delimiter of up to 32 characters without spaces, quotes or backslashes after DELIMITER.'],
        'query_confirmation_invalid' => ['nl' => 'De bevestiging moet true of false zijn.', 'en' => 'Confirmation must be true or false.'],
        'query_too_large' => ['nl' => 'Deze vraag is te groot voor het onderzoeksscherm. Gebruik phpMyAdmin voor grote scripts.', 'en' => 'This query is too large for the research screen. Use phpMyAdmin for large scripts.'],
        'query_shortened' => ['nl' => 'Dit is een begrensd voorbeeld van het resultaat. Gebruik filters of phpMyAdmin om verder te onderzoeken.', 'en' => 'This is a limited preview of the result. Use filters or phpMyAdmin to explore further.'],
        'query_read_only' => ['nl' => 'Deze onderzoeksverbinding heeft alleen leesrechten. Gebruik het phpMyAdmin-venster voor wijzigingen.', 'en' => 'This research connection is read-only. Use the phpMyAdmin window to make changes.'],
        'query_timeout' => ['nl' => 'De query is gestopt omdat de tijdslimiet is bereikt. Maak de vraag kleiner of gebruik een filter.', 'en' => 'The query stopped because it reached the time limit. Simplify the query or use a filter.'],
        'query_database_error' => ['nl' => 'De database kon deze vraag niet uitvoeren.', 'en' => 'The database could not run this query.'],
        'sql_error' => ['nl' => 'SQL-melding: {detail}', 'en' => 'SQL message: {detail}'],
        'query_name_too_long' => ['nl' => 'Geef het onderzoek een naam van maximaal 160 tekens.', 'en' => 'Give the research a name of at most 160 characters.'],
        'research_too_large' => ['nl' => 'De query of toelichting is te groot.', 'en' => 'The query or notes are too large.'],
        'saved_query_missing' => ['nl' => 'Dit opgeslagen onderzoek bestaat niet meer.', 'en' => 'This saved research no longer exists.'],
        'query_schema_missing' => ['nl' => 'De definitie voor opgeslagen onderzoeken ontbreekt in de installatie.', 'en' => 'The saved research definition is missing from this installation.'],
        'query_schema_unreadable' => ['nl' => 'De definitie voor opgeslagen onderzoeken kan niet worden gelezen.', 'en' => 'The saved research definition could not be read.'],
        'saved_query_invalid' => ['nl' => 'Kies een geldig opgeslagen onderzoek.', 'en' => 'Choose valid saved research.'],
        'relationship_missing' => ['nl' => 'Deze verwijzing bestaat niet meer. Vernieuw de structuur en kies opnieuw.', 'en' => 'This relationship no longer exists. Refresh the structure and choose again.'],
        'relationship_other_database' => ['nl' => 'Deze verwijzing loopt naar een andere database. Gebruik daarvoor de SQL-editor.', 'en' => 'This relationship points to another database. Use the SQL editor for that.'],
        'column_required' => ['nl' => 'Kies minstens één kolom om te tonen.', 'en' => 'Choose at least one column to display.'],
        'column_duplicate' => ['nl' => 'Deze kolom is meer dan één keer gekozen.', 'en' => 'This column has been selected more than once.'],
        'null_filter_has_value' => ['nl' => 'Een NULL-filter heeft geen invoerwaarde. Verwijder die waarde uit het filter.', 'en' => 'A NULL filter has no input value. Remove the value from the filter.'],
        'filter_value_missing' => ['nl' => 'Dit filter mist een waarde. Gebruik een NULL-filter wanneer je ontbrekende waarden zoekt.', 'en' => 'This filter needs a value. Use a NULL filter to find missing values.'],
        'number_invalid' => ['nl' => 'Vul een geldig getal in met een punt als decimaalteken.', 'en' => 'Enter a valid number with a point as the decimal separator.'],
        'filter_type_unsupported' => ['nl' => 'Dit veldtype kan in de querybouwer alleen op NULL worden gefilterd. Gebruik voor andere vergelijkingen de SQL-editor.', 'en' => 'The query builder only supports NULL filters for this field type. Use the SQL editor for other comparisons.'],
        'text_filter_required' => ['nl' => 'Bevat, begint met en eindigt op zijn bedoeld voor tekstkolommen.', 'en' => 'Contains, starts with and ends with are intended for text columns.'],
        'sort_duplicate' => ['nl' => 'Sorteer een kolom maar één keer.', 'en' => 'Sort each column only once.'],
        'row_limit_invalid' => ['nl' => 'Kies een geheel aantal rijen van 1 tot {max}.', 'en' => 'Choose a whole number of rows from 1 to {max}.'],
        'design_too_large' => ['nl' => 'Deze samengestelde vraag is te groot. Kies minder velden of kortere filters.', 'en' => 'This query design is too large. Choose fewer fields or shorter filters.'],
        'source_columns_missing' => ['nl' => 'Voor {table} zijn geen leesbare kolommen beschikbaar. De querybouwer kan deze bron niet gebruiken.', 'en' => 'No readable columns are available for {table}. The query builder cannot use this source.'],
        'column_missing' => ['nl' => 'Deze kolom hoort niet bij de gekozen tabel of koppeling. Vernieuw de structuur en kies opnieuw.', 'en' => 'This column is not part of the selected table or relationship. Refresh the structure and choose again.'],
        'exact_number_invalid' => ['nl' => 'Vul een exact getal in met cijfers en eventueel een punt als decimaalteken.', 'en' => 'Enter an exact number using digits and an optional point as the decimal separator.'],
        'exact_number_too_large' => ['nl' => 'Dit getal heeft meer cijfers of decimalen dan de database exact kan vergelijken.', 'en' => 'This number has more digits or decimal places than the database can compare exactly.'],
        'design_fields_invalid' => ['nl' => 'Ongeldige velden voor {field}. Vernieuw de querybouwer en controleer je keuzes.', 'en' => 'Invalid fields for {field}. Refresh the query builder and check your choices.'],
        'design_list_invalid' => ['nl' => 'Gebruik een lijst van maximaal {max} onderdelen voor {field}.', 'en' => 'Use a list of at most {max} items for {field}.'],
        'design_text_invalid' => ['nl' => 'Vul geldige tekst in voor {field} (maximaal 8192 bytes).', 'en' => 'Enter valid text for {field} (at most 8192 bytes).'],
        'design_choice_invalid' => ['nl' => 'Kies een geldige optie voor {field}.', 'en' => 'Choose a valid option for {field}.'],
        'explain_source' => ['nl' => 'Je leest de tabel of het overzicht {table}.', 'en' => 'You are reading the table or view {table}.'],
        'explain_join' => ['nl' => 'De koppeling met {table} volgt de bestaande verwijzing {key}.', 'en' => 'The join with {table} follows the existing relationship {key}.'],
        'explain_left_join' => ['nl' => 'LEFT JOIN houdt rijen zonder gekoppelde match aanvankelijk zichtbaar. Filters op gekoppelde velden kunnen die rijen alsnog uitsluiten.', 'en' => 'LEFT JOIN initially keeps rows without a related match visible. Filters on related fields can still exclude those rows.'],
        'explain_inner_join' => ['nl' => 'INNER JOIN laat alleen rijen zien waarvoor een gekoppelde match bestaat.', 'en' => 'INNER JOIN only shows rows with a related match.'],
        'explain_all_filters' => ['nl' => 'Alle filters moeten tegelijk kloppen (AND).', 'en' => 'All filters must match together (AND).'],
        'explain_any_filter' => ['nl' => 'Minstens één filter moet kloppen (OR).', 'en' => 'At least one filter must match (OR).'],
        'explain_null' => ['nl' => 'NULL betekent dat een waarde ontbreekt; dat is iets anders dan lege tekst. Tekstvergelijkingen volgen de ingestelde databasecollatie.', 'en' => 'NULL means a value is missing; it is different from empty text. Text comparisons follow the configured database collation.'],
        'explain_no_sort' => ['nl' => 'Zonder sortering is de volgorde van de rijen niet gegarandeerd.', 'en' => 'Without sorting, the order of rows is not guaranteed.'],
        'explain_limit' => ['nl' => 'Je toont maximaal {limit} rijen. De SQL-editor blijft beschikbaar voor een verder uitgewerkte vraag.', 'en' => 'You are displaying at most {limit} rows. The SQL editor remains available for a more detailed query.'],
        'field.query' => ['nl' => 'de query', 'en' => 'the query'],
        'field.table_name' => ['nl' => 'de tabelnaam', 'en' => 'the table name'],
        'field.join' => ['nl' => 'de koppeling', 'en' => 'the join'],
        'field.relationship_name' => ['nl' => 'de naam van de verwijzing', 'en' => 'the relationship name'],
        'field.join_type' => ['nl' => 'het soort koppeling', 'en' => 'the join type'],
        'field.columns' => ['nl' => 'de gekozen kolommen', 'en' => 'the selected columns'],
        'field.column' => ['nl' => 'een gekozen kolom', 'en' => 'a selected column'],
        'field.match' => ['nl' => 'de filtercombinatie', 'en' => 'the filter combination'],
        'field.filters' => ['nl' => 'de filters', 'en' => 'the filters'],
        'field.filter' => ['nl' => 'een filter', 'en' => 'a filter'],
        'field.operator' => ['nl' => 'de filterbewerking', 'en' => 'the filter operator'],
        'field.value' => ['nl' => 'de filterwaarde', 'en' => 'the filter value'],
        'field.sorts' => ['nl' => 'de sorteringen', 'en' => 'the sorting fields'],
        'field.sort' => ['nl' => 'een sortering', 'en' => 'a sorting field'],
        'field.direction' => ['nl' => 'de sorteerrichting', 'en' => 'the sort direction'],
        'field.source' => ['nl' => 'de herkomst van de kolom', 'en' => 'the column source'],
        'field.column_name' => ['nl' => 'de kolomnaam', 'en' => 'the column name'],
        'snapshot_open_failed' => ['nl' => 'Het herstelpunt kan niet worden geopend.', 'en' => 'The restore point could not be opened.'],
        'database_missing_warning' => ['nl' => 'De database bestaat niet. Je kunt onder Experimenten een herstelpunt terugzetten.', 'en' => 'The database does not exist. You can restore a point under Experiments.'],
        'database_unavailable_warning' => ['nl' => 'De database is niet bereikbaar of nog niet gereed. Controleer of Docker draait. Herstelpunten blijven beschikbaar.', 'en' => 'The database is unavailable or not ready yet. Check that Docker is running. Restore points remain available.'],
        'design_only' => ['nl' => 'Verstuur alleen het ontwerp van de query.', 'en' => 'Send only the query design.'],
        'query_shape_invalid' => ['nl' => 'Verstuur één SQL-script met eventueel confirm, of één ontwerp.', 'en' => 'Send one SQL script with optional confirm, or one design.'],
        'action_missing' => ['nl' => 'Deze handeling bestaat niet.', 'en' => 'This action does not exist.'],
        'read_attempted_write' => ['nl' => 'Deze leesopdracht probeert gegevens te wijzigen. Gebruik het phpMyAdmin-venster voor wijzigingen.', 'en' => 'This read query tries to change data. Use the phpMyAdmin window to make changes.'],
        'database_action_failed' => ['nl' => 'De database kon deze handeling niet uitvoeren. Vernieuw de werkplek of controleer de databaseverbinding.', 'en' => 'The database could not complete this action. Refresh the workspace or check the database connection.'],
        'internal_error' => ['nl' => 'Er ging iets mis in de werkplek. Bekijk de lokale applicatielog voor meer informatie.', 'en' => 'Something went wrong in the workspace. Check the local application log for more information.'],
        'request_failed' => ['nl' => 'Het verzoek kon niet worden uitgevoerd.', 'en' => 'The request could not be completed.'],
        'backup_directory_invalid' => ['nl' => 'De map voor herstelpunten is ongeldig.', 'en' => 'The restore point folder is invalid.'],
        'backup_directory_create_failed' => ['nl' => 'De map voor herstelpunten kon niet worden aangemaakt.', 'en' => 'The restore point folder could not be created.'],
        'backup_directory_not_writable' => ['nl' => 'De map voor herstelpunten is niet beschrijfbaar.', 'en' => 'The restore point folder is not writable.'],
        'snapshot_label_invalid' => ['nl' => 'Geef het herstelpunt een korte, leesbare naam.', 'en' => 'Give the restore point a short, readable name.'],
        'restore_confirmation_invalid' => ['nl' => 'Typ de exacte databasenaam om het terugzetten te bevestigen.', 'en' => 'Type the exact database name to confirm restoration.'],
        'restore_recovery_failed' => ['nl' => 'Het terugzetten en automatisch herstel zijn gestopt. De database kan gedeeltelijk zijn hersteld. Het herstelpunt {id} is bewaard.', 'en' => 'Restoration and automatic recovery stopped. The database may be partially restored. Restore point {id} has been kept.'],
        'restore_recovered' => ['nl' => 'Het gekozen herstelpunt kon niet worden teruggezet. De vorige toestand is hersteld vanuit {id}.', 'en' => 'The selected restore point could not be restored. The previous state was recovered from {id}.'],
        'restore_no_safety' => ['nl' => 'Het terugzetten is gestopt. Er bestond geen werkdatabase om vooraf te bewaren; het gekozen herstelpunt blijft beschikbaar.', 'en' => 'Restoration stopped. There was no working database to back up first; the selected restore point remains available.'],
        'restore_created_database' => ['nl' => 'De ontbrekende werkdatabase is opnieuw aangemaakt vanuit het herstelpunt.', 'en' => 'The missing working database was recreated from the restore point.'],
        'restore_succeeded' => ['nl' => 'Het herstelpunt is teruggezet. De vorige toestand is apart bewaard.', 'en' => 'The restore point was restored. The previous state was saved separately.'],
        'backup_database_missing' => ['nl' => 'De werkdatabase bestaat niet. Je kunt wel een eerder herstelpunt terugzetten.', 'en' => 'The working database does not exist. You can still restore an earlier point.'],
        'snapshot_write_failed' => ['nl' => 'Het SQL-bestand kon niet worden geschreven.', 'en' => 'The SQL file could not be written.'],
        'snapshot_empty' => ['nl' => 'De SQL-export is leeg of onvolledig. Er is geen herstelpunt opgeslagen.', 'en' => 'The SQL export is empty or incomplete. No restore point was saved.'],
        'snapshot_finish_sql_failed' => ['nl' => 'Het SQL-bestand kon niet worden afgerond.', 'en' => 'The SQL file could not be completed.'],
        'snapshot_metadata_failed' => ['nl' => 'De gegevens van het herstelpunt konden niet worden opgeslagen.', 'en' => 'The restore point metadata could not be saved.'],
        'snapshot_finish_failed' => ['nl' => 'Het herstelpunt kon niet worden afgerond.', 'en' => 'The restore point could not be completed.'],
        'restore_temp_failed' => ['nl' => 'Er kon geen tijdelijk herstelbestand worden gemaakt.', 'en' => 'A temporary restore file could not be created.'],
        'snapshot_charset_unavailable' => ['nl' => 'De tekenset van dit herstelpunt is niet beschikbaar op deze database-server.', 'en' => 'The character set of this restore point is not available on this database server.'],
        'snapshot_owner_invalid' => ['nl' => 'Een databaseobject heeft een andere eigenaar dan de werkdatabasegebruiker. Maak hiervan eerst een passende export; er is geen onvolledig herstelpunt opgeslagen.', 'en' => 'A database object has a different owner from the working database user. Make a suitable export first; no incomplete restore point was saved.'],
        'snapshot_routine_unknown' => ['nl' => 'Onbekend routinetype; het herstelpunt is niet gemaakt.', 'en' => 'Unknown routine type; the restore point was not created.'],
        'snapshot_routine_charset_invalid' => ['nl' => 'De tekenset van een routine kan niet veilig worden bewaard.', 'en' => 'A routine character set could not be preserved safely.'],
        'snapshot_routine_unreadable' => ['nl' => 'Een routine kan niet worden uitgelezen. Er is geen onvolledig herstelpunt opgeslagen.', 'en' => 'A routine could not be read. No incomplete restore point was saved.'],
        'snapshot_missing' => ['nl' => 'Dit herstelpunt bestaat niet.', 'en' => 'This restore point does not exist.'],
        'snapshot_invalid' => ['nl' => 'Het herstelpunt is onvolledig of hoort bij een andere database.', 'en' => 'The restore point is incomplete or belongs to another database.'],
        'snapshot_changed' => ['nl' => 'Het SQL-bestand is gewijzigd sinds het herstelpunt is gemaakt. Terugzetten is gestopt.', 'en' => 'The SQL file has changed since the restore point was created. Restoration stopped.'],
        'snapshot_id_invalid' => ['nl' => 'Ongeldig herstelpunt.', 'en' => 'Invalid restore point.'],
        'backup_identifier_invalid' => ['nl' => 'Ongeldige databasenaam of objectnaam.', 'en' => 'Invalid database or object name.'],
        'client_settings_create_failed' => ['nl' => 'Tijdelijke database-instellingen konden niet worden gemaakt.', 'en' => 'Temporary database settings could not be created.'],
        'client_settings_write_failed' => ['nl' => 'Tijdelijke database-instellingen konden niet worden geschreven.', 'en' => 'Temporary database settings could not be written.'],
        'database_client_start_failed' => ['nl' => 'De databaseclient kon niet worden gestart.', 'en' => 'The database client could not be started.'],
        'database_client_timeout' => ['nl' => 'De databasebewerking duurde te lang en is gestopt.', 'en' => 'The database operation took too long and was stopped.'],
        'database_client_error_detail' => ['nl' => ' Databasefout {code}.', 'en' => ' Database error {code}.'],
        'database_client_failed' => ['nl' => 'De databaseclient is gestopt met foutcode {exit}.{detail} Er is geen succesvolle bewerking gemeld.', 'en' => 'The database client stopped with exit code {exit}.{detail} No successful operation was reported.'],
        'snapshot_lock_failed' => ['nl' => 'Het herstelpunten-slot kon niet worden geopend.', 'en' => 'The restore point lock could not be opened.'],
        'snapshot_busy' => ['nl' => 'Er wordt al een herstelpunt gemaakt of teruggezet. Probeer het zo opnieuw.', 'en' => 'A restore point is already being created or restored. Try again shortly.'],
    ];

    /** Highest-quality supported locale. Missing, unsupported and q=0 use Dutch. */
    public static function language(?string $header = null): string
    {
        $header ??= (string) ($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '');
        $best = 'nl';
        $quality = 0.0;
        foreach (explode(',', substr($header, 0, 1024)) as $entry) {
            if (!preg_match('/^\s*(nl|en)(?:-[a-z0-9]{1,8})*\s*(?:;\s*q=(0(?:\.\d{1,3})?|1(?:\.0{1,3})?))?\s*$/iD', $entry, $match)) {
                continue;
            }
            $weight = isset($match[2]) ? (float) $match[2] : 1.0;
            if ($weight > $quality) {
                $best = strtolower($match[1]);
                $quality = $weight;
            }
        }
        return $best;
    }

    public static function text(string $key, array $parameters = [], ?string $language = null): string
    {
        if (!isset(self::TEXT[$key])) {
            throw new \LogicException('Unknown Govern message key: ' . $key);
        }
        $language ??= self::language();
        if ($key === 'database_client_failed') {
            $parameters['detail'] = isset($parameters['database_code'])
                ? self::text('database_client_error_detail', ['code' => $parameters['database_code']], $language)
                : '';
        }
        $message = self::TEXT[$key][$language === 'en' ? 'en' : 'nl'];
        $replacements = [];
        foreach ($parameters as $name => $value) {
            if ($name === 'field' && is_string($value) && str_starts_with($value, 'field.') && isset(self::TEXT[$value])) {
                $value = self::text($value, [], $language);
            }
            if (is_string($value) || is_int($value) || is_float($value)) {
                $replacements['{' . $name . '}'] = (string) $value;
            }
        }
        return strtr($message, $replacements);
    }

    public static function has(string $key): bool
    {
        return isset(self::TEXT[$key]);
    }

    /** Cached results can change language without executing the query again. */
    public static function translations(string $key, array $parameters = []): array
    {
        return ['nl' => self::text($key, $parameters, 'nl'), 'en' => self::text($key, $parameters, 'en')];
    }

    public static function explanations(array $messages, ?string $language = null): array
    {
        return array_map(static fn (array $message): string => self::text($message['code'], $message['params'] ?? [], $language), $messages);
    }
}
