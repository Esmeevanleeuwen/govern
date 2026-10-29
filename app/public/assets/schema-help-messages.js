import {registerMessages} from './i18n.js';

const entries = {
    open: ['Wat kan ik hier doen?', 'What can I do here?'],
    title: ['Ontdek je databaseschema', 'Explore your database schema'],
    intro: ['Bekijk hoe je tabellen zijn opgebouwd en met elkaar verbonden. Dit kun je in deze werkplek doen.', 'See how your tables are built and connected. Here is what you can do in this workspace.'],
    close: ['Uitleg sluiten', 'Close guide'],
    done: ['Terug naar het schema', 'Back to the schema'],
    exploreTitle: ['Tabellen en kolommen vinden', 'Find tables and columns'],
    exploreBody: ['Zoek op een tabelnaam of kolomnaam. De tekening toont de gevonden tabellen. PK betekent primaire sleutel; FK betekent foreign key, een verwijzing naar een andere kolom.', 'Search by table or column name. The diagram shows matching tables. PK means primary key; FK means foreign key, a reference to another column.'],
    connectionsTitle: ['Verbindingen volgen', 'Follow connections'],
    connectionsBody: ['Selecteer een tabel om inkomende en uitgaande verwijzingen te bekijken. Open alle kolommen, volg een gekoppelde tabel of kies Verbindingen in beeld om alleen directe verbindingen te tonen.', 'Select a table to inspect incoming and outgoing references. Open all columns, follow a linked table, or choose Focus connections to show its direct connections.'],
    navigateTitle: ['Zoomen en verschuiven', 'Zoom and pan'],
    navigateBody: ['Scroll boven de tekening om rond je muisaanwijzer te zoomen. Sleep de achtergrond om te verschuiven. Gebruik de zoomknoppen, 100% of Alles passend maken voor een duidelijk overzicht.', 'Scroll over the diagram to zoom around your pointer. Drag the background to pan. Use the zoom buttons, 100%, or Fit diagram to find a useful view.'],
    arrangeTitle: ['Je tekening indelen', 'Arrange your diagram'],
    arrangeBody: ['Sleep een tabel aan de titel om haar te verplaatsen. Tabelposities worden in deze browser bewaard. Automatisch indelen zet de tabellen opnieuw neer; databasegegevens blijven behouden.', 'Drag a table by its title to move it. Table positions are saved in this browser. Arrange automatically resets their placement and keeps database records intact.'],
    toolsTitle: ['Het tweede menu gebruiken', 'Use the second menu'],
    toolsBody: ['Klik op Tabellen of Geselecteerd om het bijbehorende paneel uit te klappen. Klik nogmaals op de actieve tool om het in te klappen. Via de gekozen tabel kun je Gegevens of Structuur openen.', 'Click Tables or Selection to expand the related panel. Click the active tool again to collapse it. From a selected table, you can open Browse data or View structure.'],
    refreshTitle: ['De actuele structuur bekijken', 'Read the current structure'],
    refreshBody: ['Heb je de database gewijzigd? Kies Schema verversen om de actuele tabellen, kolommen en verwijzingen opnieuw te lezen. Je eigen indeling blijft behouden voor tabellen die nog bestaan.', 'Changed the database? Choose Refresh schema to read its current tables, columns and references. Your placement is kept for tables that still exist.'],
    keyboardTitle: ['Met het toetsenbord', 'With the keyboard'],
    canvasKeys: ['Tekening actief: pijltoetsen verschuiven, + en − zoomen, Home maakt alles passend.', 'Canvas focused: arrow keys pan, + and − zoom, Home fits the diagram.'],
    tableKeys: ['Tabeltitel actief: pijltoetsen verplaatsen de tabel; met Shift gaat dit in grotere stappen.', 'Table title focused: arrow keys move the table; hold Shift for larger steps.'],
    limits: ['Lijnen tonen alleen foreign keys die in de database zijn vastgelegd. Views en overeenkomstige kolomnamen leveren geen veronderstelde verbindingen op. Het diagram bekijken en verplaatsen verandert geen tabellen, kolommen of records.', 'Lines show only foreign keys declared in the database. Views and matching column names do not create inferred connections. Viewing and moving the diagram does not change tables, columns or records.'],
};

registerMessages('app.schemaHelp', Object.fromEntries(['nl', 'en'].map((language, index) =>
    [language, Object.fromEntries(Object.entries(entries).map(([key, values]) => [key, values[index]]))])));
