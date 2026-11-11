// ==UserScript==
// @name         Torn War Watchlist
// @namespace    torn-war-watchlist
// @version      2.22.0
// @description  Ranked war watchlist for Torn: players and whole factions, hospital countdown, last-action colors, FF Scouter, chain timer
// @author       Provadis
// @homepageURL  https://github.com/Provadis/torn-war-watchlist
// @supportURL   https://github.com/Provadis/torn-war-watchlist/issues
// @updateURL    https://raw.githubusercontent.com/Provadis/torn-war-watchlist/main/torn-war-watchlist.user.js
// @downloadURL  https://raw.githubusercontent.com/Provadis/torn-war-watchlist/main/torn-war-watchlist.user.js
// @match        https://www.torn.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @connect      ffscouter.com
// @connect      raw.githubusercontent.com
// @connect      api.github.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ---- Settings -----------------------------------------------------------
  const DEFAULT_REFRESH_S = 60;   // default: refresh the whole list every 60 s (changeable in the panel)
  const MIN_REFRESH_S = 15;
  const MAX_REFRESH_S = 600;
  const REFRESH_PRESETS = [15, 30, 60, 120, 300]; // choices in the touch settings grid
  const REQUEST_GAP_MS = 700;     // gap between API calls (Torn limit: 100/min)
  // Version and update URL come from the header (@version / @downloadURL)
  const GMI = typeof GM_info !== 'undefined' ? GM_info : null;
  const SCRIPT_VERSION = (GMI && GMI.script.version) || '';
  const UPDATE_URL = (GMI && (GMI.script.downloadURL || GMI.script.updateURL))
    || 'https://raw.githubusercontent.com/Provadis/torn-war-watchlist/main/torn-war-watchlist.user.js';
  const GREEN_AFTER_S = 15 * 60;  // > 15 min inactive  -> green
  const ORANGE_AFTER_S = 10 * 60; // 10–15 min inactive -> orange, below that red

  // ---- Storage (shared between all Torn tabs) -----------------------------
  const getList = () => GM_getValue('list', []);
  const setList = (list) => GM_setValue('list', list);
  const getKey = () => GM_getValue('apiKey', '');
  const getRefreshS = () => GM_getValue('refreshS', DEFAULT_REFRESH_S);
  const isPaused = () => GM_getValue('paused', false);

  // Watched factions: { id, name, tag, hidden: [player IDs], members: [{ id, name, ts }], error }
  // Their members come with ONE call per faction; "hidden" only hides single players.
  const getFactions = () => GM_getValue('factions', []);
  const setFactions = (factions) => GM_setValue('factions', factions);

  // Persistent settings (for export/import and the backup); caches like hits or the last
  // refresh are not included. One value check per key.
  const isBool = (v) => typeof v === 'boolean';
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const SETTINGS = {
    apiKey: (v) => typeof v === 'string',
    list: Array.isArray,
    factions: Array.isArray,
    refreshS: isNum,
    paused: isBool,
    hitsOn: isBool,
    chainOn: isBool,
    nyan: isBool,
    soundOn: isBool,
    soundVol: isNum,
    side: (v) => v === 'left' || v === 'right',
    pos: (v) => v === null || (isObj(v) && isNum(v.x) && isNum(v.y)),
    size: (v) => v === null || isObj(v),
    collapsed: isBool,
    collapsedGroups: isObj,
    ffOn: isBool,
    ffKey: (v) => typeof v === 'string',
    lang: (v) => v === 'de' || v === 'en',
    view: (v) => v === 'list' || v === 'tiles',
    tab: (v) => v === 'list' || v === 'honors',
    honMode: (v) => v === 'easy' || v === 'cat' || v === 'all',
    honorsDone: Array.isArray,
    honorsHidden: Array.isArray,
  };

  // ---- Language (English / German) ----------------------------------------
  // t('key', ...args): texts without placeholders are strings, with placeholders functions.
  const I18N = {
    de: {
      dragHint: 'Ziehen zum Verschieben, Doppelklick zum Andocken',
      refreshNow: 'Jetzt aktualisieren',
      settings: 'Einstellungen',
      dock: 'An den Rand andocken / Seite wechseln',
      collapse: 'Ein-/Ausklappen',
      addPlayer: '+ Spieler',
      addPlayerTitle: 'Spieler mit dieser ID hinzufügen',
      addFaction: '+ Faction',
      addFactionTitle: 'Faction mit dieser ID hinzufügen',
      resize: 'Größe ändern (Doppelklick: zurücksetzen)',
      back: '← Zurück',
      language: 'Sprache',
      secFeatures: 'Funktionen',
      secKeys: 'Keys',
      secInterval: 'Update-Intervall',
      secData: 'Daten',
      secHelp: 'Hilfe',
      tabHonors: 'Honors',
      tabWatchlist: '🎃 Watchlist',
      honModeEasy: 'Einfach',
      honModeCat: 'Kategorien',
      honModeAll: 'Alle',
      honAllTiers: (n) => `Alle ${n}`,
      honAllCats: 'Alle',
      honSearch: 'Honors suchen…',
      honSortDiff: 'Leichteste zuerst',
      honSortRarity: 'Seltenste zuerst',
      honSortName: 'A → Z',
      honShowEarned: 'Erhaltene zeigen',
      honHideEarned: 'Erhaltene ausblenden',
      honShowHidden: 'Ausgeblendete zeigen',
      honHideHidden: 'Ausgeblendete verstecken',
      honSync: '🔄 Sync',
      honSyncTitle: 'Echten Stand von Torn laden – eigene ✓-Markierungen werden dabei zurückgesetzt',
      honAgo: (a) => `vor ${a}`,
      honLoading: 'Lade Honors…',
      honNoKey: 'Bitte zuerst einen Torn API-Key setzen (⚙ → Torn API-Key).',
      honNoData: 'Noch keine Daten – ⟳ lädt sie.',
      honAccess: 'Der API-Key hat dafür nicht genug Zugriff (mindestens Limited).',
      honEmpty: 'Nichts passt zu deinen Filtern.',
      honTierLeft: (n) => `${n} offen`,
      honTierDone: (n) => `alle ${n} erhalten ✓`,
      honGuide: '▸ Anleitung',
      honGuideClose: '▾ Anleitung',
      honNoGuide: 'Noch keine Anleitung – schau ins Torn-Forum.',
      honDone: '✓ Erledigt',
      honUndo: 'Rückgängig',
      honHide: 'Ausblenden',
      honUnhide: 'Zeigen',
      honEarnedBadge: 'Erhalten',
      honMarkedBadge: 'Als erledigt markiert',
      honTierNames: ['', 'Sofort', 'Leicht', 'Kostet Geld', 'Grind', 'Komplex', 'Unbekannt'],
      honTierDescs: ['', 'geht sofort, kaum Kosten', 'evtl. mit einem Freund oder kurzer Absprache', 'geht sofort, kostet aber Geld',
        'einfach, braucht aber Zeit oder Wiederholung', 'mehrstufig, Glück oder knifflig', 'noch keine Anleitung'],
      honCats: { 0: 'Sonstiges', 1: 'Standard', 2: 'Waffen', 3: 'Tarnung', 4: 'Bildung', 5: 'Verbrechen', 6: 'Drogen',
        7: 'Reisen', 8: 'Angriff', 9: 'Casino', 10: 'Gym', 11: 'Treue', 12: 'Level', 13: 'Wettbewerbe', 14: 'Geld',
        15: 'Gefängnis', 16: 'Gegenstände', 17: 'Missionen', 18: 'Krankenhaus' },
      secView: 'Ansicht',
      viewList: 'Liste',
      viewTiles: 'Kacheln',
      seen: (age) => `vor ${age}`,
      seenNow: 'online',
      menuAttack: '⚔ Angreifen',
      menuProfile: '👤 Profil',
      menuCopy: '📋 Kopieren',
      menuRemove: '✕ Entfernen',
      tileOn: 'AN',
      tileOff: 'AUS',
      tileChain: 'Chain-Timer',
      tileSound: 'Bomben-Sound',
      tilePaused: 'API pausiert',
      tileApiKey: 'Torn API-Key',
      tileFfKey: 'FF-Key',
      tileFfReload: 'FF neu laden',
      chainTip: 'Chain-Zähler und Timer im Panel, unter 1:30 rot blinkend',
      ffTip: 'Fair-Fight-Werte von ffscouter.com neben jedem Spieler',
      hitsTip: 'Leiste mit deinen erfolgreichen Angriffen seit 00:00 TCT',
      nyanTip: 'Ab und zu läuft Nyan Cat am Rahmen entlang',
      pauseTip: 'Keine automatischen API-Abfragen, solange an',
      customInterval: (s) => `eigener Wert: ${s} s`,
      version: (v) => `Version ${v}`,
      checkUpdates: '🔄 Nach Updates suchen',
      checkUpdatesTitle: 'Prüft auf GitHub, ob es eine neuere Version gibt',
      updChecking: 'Prüfe…',
      updLatest: '✓ Aktuell',
      updAvailable: (v) => `⬆ ${v} verfügbar`,
      updInstall: 'Installieren',
      updInstallTitle: 'Am PC zeigt Tampermonkey dann den Update-Dialog. Am iPhone: in Safari das Tampermonkey-Menü öffnen → „Nach Userscript-Updates suchen“.',
      updFailed: 'Prüfung fehlgeschlagen',
      miniTitle: 'Watchlist öffnen (ziehen zum Verschieben)',
      apiKey: '🔑 Torn API-Key',
      apiKeyTitle: 'Torn API-Key setzen',
      apiKeySet: 'gesetzt',
      apiKeyMissing: 'fehlt',
      apiKeyPrompt: 'Torn API-Key (Public Access reicht):',
      updateEvery: 'Update alle',
      perMin: (n) => `≈ ${n} Abfragen/min`,
      callsPerUpdate: (n) => `${n} Calls pro Update`,
      ffKey: 'Key',
      ffKeyTitle: 'FF-Scouter-Key setzen',
      ffReload: '🔄 FF neu laden',
      ffReloadTitle: 'Zwischenspeicher leeren und alle FF-Werte sofort neu holen (z. B. nach dem Gym)',
      ffKeyPrompt: 'FF-Scouter-Key: ein Torn-API-Key, der bei ffscouter.com registriert ist.\nLeer lassen = den Watchlist-API-Key verwenden.',
      ffOwnKey: 'eigener Key',
      ffWatchlistKey: 'Watchlist-Key',
      ffNoKey: 'kein Key',
      ffNotRegistered: 'Key nicht bei FF Scouter registriert',
      ffUnexpected: 'Unerwartete Antwort',
      ffLoading: 'FF Scouter: wird beim nächsten Update geladen',
      ffNoData: 'FF Scouter: keine Daten zu diesem Spieler',
      ffLevels: ['extrem leicht', 'leicht', 'mittel', 'schwer', 'evtl. unmöglich'],
      ffStats: (bs) => `Geschätzte Stats: ${bs}`,
      ffAge: (age, old) => `Schätzung von vor ${age}${old ? ' (alt)' : ''}`,
      chainToggle: '⛓ Chain-Timer',
      sound: '💣 Bomben-Sound',
      soundTitle: 'Piepen ab 1:30, ab 0:30 schneller, bei 0 Explosion',
      volume: 'Lautstärke',
      soundTestTitle: 'Die letzten Sekunden + Explosion probehören',
      exportTitle: 'Einstellungen, API-Key, Spieler und Factions als Datei speichern',
      importTitle: 'Einstellungen aus einer Export-Datei laden (ersetzt die aktuellen)',
      importBadJson: 'Import fehlgeschlagen: Die Datei ist kein gültiges JSON.',
      importNotOurs: 'Import fehlgeschlagen: Das ist keine Export-Datei der Watchlist.',
      importEmpty: 'Import fehlgeschlagen: Die Datei enthält keine Einstellungen.',
      importReadFail: 'Import fehlgeschlagen: Die Datei konnte nicht gelesen werden.',
      importConfirm: (p, f, key) => `Einstellungen importieren?\n\n${p} Spieler, ${f} Factions${key ? ', API-Key' : ''}.\nDeine aktuellen Einstellungen werden dabei ersetzt.`,
      removeFactionConfirm: (name) => `Faction "${name}" von der Watchlist entfernen?`,
      needKey: 'Bitte zuerst einen API-Key setzen (⚙ → Torn API-Key).',
      searchingFaction: 'Suche Faction…',
      apiError: (e) => `API-Fehler: ${e}`,
      error: (e) => `Fehler: ${e}`,
      notInFaction: 'Dieser Spieler ist in keiner Faction.',
      invalidResponse: 'Ungültige Antwort',
      networkError: 'Netzwerkfehler',
      timeout: 'Timeout',
      noFaction: 'Ohne Faction',
      notLoaded: 'Noch nicht geladen',
      needsLimited: 'braucht Limited-Key',
      traveling: '✈ Reist',
      abroad: '✈ Ausland',
      lastAction: (age) => `Last action: vor ${age}`,
      remove: 'Entfernen',
      watchedFaction: 'Faction auf der Watchlist',
      removeFaction: 'Faction von der Watchlist entfernen',
      noDataYet: 'Noch keine Daten – wird beim nächsten Update geladen.',
      restoreAll: (n) => `↺ Alle Spieler der Faction wiederherstellen (${n} ausgeblendet)`,
      emptyList: 'Noch niemand auf der Liste.',
      onListRemove: '✓ Spieler auf der Liste – entfernen',
      addProfile: (id) => `+ Spieler hinzufügen [${id}]`,
      factionOnList: (name) => `✓ Faction ${name} ist auf der Liste`,
      addPlayerFaction: (name) => (name ? `+ Faction ${name} hinzufügen` : '+ Faction des Spielers hinzufügen'),
      factionPageOnList: '✓ Faction auf der Liste – entfernen',
      addThisFaction: (id) => `+ Diese Faction hinzufügen [${id}]`,
      hitsStrip: (n) => `🎯 Heute: ${n} Hits`,
      hitsTitle: (att, hits, war) => `${att} eigene Angriffe heute (seit 00:00 TCT), davon ${hits} erfolgreich (${war} im Ranked War).\nKlicken zum Aktualisieren.`,
      resume: 'API-Abfragen fortsetzen',
      pause: 'API-Abfragen pausieren',
      footPaused: '⏸ API-Abfragen pausiert',
      footNoKey: 'Kein API-Key gesetzt – ⚙ → Torn API-Key.',
      footUpdating: 'Aktualisiere…',
      footLast: (age) => `Letztes Update vor ${age}`,
      legend: '📖 Legende',
      lgExample: 'Erfundenes Beispiel – so sehen die Zeilen in der Liste aus',
      lgExampleName: 'Beispielspieler',
      lgRows: 'Zeilenfarbe = Last Action',
      lgGreen: 'Über 15 min inaktiv – vermutlich offline',
      lgOrange: '10–15 min inaktiv',
      lgRed: 'Unter 10 min – gerade aktiv',
      lgGray: 'Noch keine Daten geladen',
      lgStatus: 'Status',
      lgOkay: 'Nicht im Hospital – angreifbar',
      lgHosp: 'Im Hospital, Restzeit bis zur Entlassung',
      lgJail: 'Im Jail / Federal Jail, Restzeit',
      lgTravel: 'Fliegt gerade',
      lgAbroad: 'Ist im Ausland',
      lgFF: 'FF-Wert (FF Scouter)',
      lgFFEasy: 'Blau – leicht (FF um 1)',
      lgFFMid: 'Grün/Gelb – mittel',
      lgFFHard: 'Rot – schwer (FF 5 und mehr)',
      lgFFOld: 'Schätzung älter als 14 Tage',
      lgFFNone: 'Keine Daten bei FF Scouter',
      lgFFLoading: 'Wird beim nächsten Update geladen',
      lgOther: 'Sonstiges',
      lgStar: 'Faction steht auf der Watchlist',
      lgBadges: 'Anzahl Spieler pro Zeilenfarbe in der Gruppe',
      lgChain: 'Chain-Timer unter 1:30: Box blinkt rot, Panel leuchtet rot',
      lgRemove: 'Spieler entfernen (bei Factions: nur ausblenden)',
      lgRestore: 'Ausgeblendete Spieler der Faction wieder anzeigen',
      lgSort: 'Sortierung: Wer nicht im Hospital ist, steht oben (am längsten inaktiv zuerst), danach nach Hospital-Restzeit.',
      lgHover: 'Tipp: Maus über eine Zeile bzw. den FF-Wert zeigt Details (Last Action, geschätzte Stats).',
      warAdd: 'Zur Watchlist hinzufügen',
      warOnList: 'Steht auf der Watchlist – klicken zum Entfernen',
      warCopy: 'Name [ID] mit Profil-Link kopieren',
      warCopied: 'Kopiert!',
      warCopyFailed: 'Kopieren fehlgeschlagen',
    },
    en: {
      dragHint: 'Drag to move, double-click to dock',
      refreshNow: 'Refresh now',
      settings: 'Settings',
      dock: 'Dock to the edge / switch side',
      collapse: 'Collapse / expand',
      addPlayer: '+ Player',
      addPlayerTitle: 'Add the player with this ID',
      addFaction: '+ Faction',
      addFactionTitle: 'Add the faction with this ID',
      resize: 'Resize (double-click: reset)',
      back: '← Back',
      language: 'Language',
      secFeatures: 'Features',
      secKeys: 'Keys',
      secInterval: 'Update interval',
      secData: 'Data',
      secHelp: 'Help',
      tabHonors: 'Honors',
      tabWatchlist: '🎃 Watchlist',
      honModeEasy: 'Easy wins',
      honModeCat: 'Categories',
      honModeAll: 'All',
      honAllTiers: (n) => `All ${n}`,
      honAllCats: 'All',
      honSearch: 'Search honors…',
      honSortDiff: 'Easiest first',
      honSortRarity: 'Rarest first',
      honSortName: 'A → Z',
      honShowEarned: 'Show earned',
      honHideEarned: 'Hide earned',
      honShowHidden: 'Show hidden',
      honHideHidden: 'Hide hidden',
      honSync: '🔄 Sync',
      honSyncTitle: 'Load your real state from Torn – your own ✓ marks are reset',
      honAgo: (a) => `${a} ago`,
      honLoading: 'Loading honors…',
      honNoKey: 'Set a Torn API key first (⚙ → Torn API key).',
      honNoData: 'No data yet – ⟳ loads it.',
      honAccess: "The API key doesn't have enough access for this (at least Limited).",
      honEmpty: 'Nothing matches your filters.',
      honTierLeft: (n) => `${n} to get`,
      honTierDone: (n) => `all ${n} earned ✓`,
      honGuide: '▸ How to get it',
      honGuideClose: '▾ How to get it',
      honNoGuide: 'No guide yet — check the Torn forums.',
      honDone: '✓ Done',
      honUndo: 'Undo',
      honHide: 'Hide',
      honUnhide: 'Show',
      honEarnedBadge: 'Earned',
      honMarkedBadge: 'Marked done',
      honTierNames: ['', 'Instant', 'Easy', 'Costs money', 'Grind', 'Complex', 'Unknown'],
      honTierDescs: ['', 'do it right now with little or no cost', 'might need a friend or quick coordination',
        'can do it now but requires spending', 'simple but needs time or repetition', 'multi-step, RNG-heavy or tricky', 'no guide yet'],
      honCats: { 0: 'Misc', 1: 'Default', 2: 'Weapons', 3: 'Camo', 4: 'Education', 5: 'Crimes', 6: 'Drugs', 7: 'Travel',
        8: 'Attacking', 9: 'Casino', 10: 'Gym', 11: 'Commitment', 12: 'Level', 13: 'Competitions', 14: 'Money', 15: 'Jail',
        16: 'Items', 17: 'Missions', 18: 'Hospital' },
      secView: 'View',
      viewList: 'List',
      viewTiles: 'Tiles',
      seen: (age) => `${age} ago`,
      seenNow: 'online',
      menuAttack: '⚔ Attack',
      menuProfile: '👤 Profile',
      menuCopy: '📋 Copy',
      menuRemove: '✕ Remove',
      tileOn: 'ON',
      tileOff: 'OFF',
      tileChain: 'Chain timer',
      tileSound: 'Bomb sound',
      tilePaused: 'API paused',
      tileApiKey: 'Torn API key',
      tileFfKey: 'FF key',
      tileFfReload: 'Reload FF',
      chainTip: 'Chain count and timer in the panel, blinks red below 1:30',
      ffTip: 'Fair fight values from ffscouter.com next to every player',
      hitsTip: 'Strip with your successful attacks since 00:00 TCT',
      nyanTip: 'Every now and then Nyan Cat runs along the border',
      pauseTip: 'No automatic API requests while on',
      customInterval: (s) => `custom value: ${s} s`,
      version: (v) => `Version ${v}`,
      checkUpdates: '🔄 Check for updates',
      checkUpdatesTitle: 'Checks GitHub for a newer version',
      updChecking: 'Checking…',
      updLatest: '✓ Up to date',
      updAvailable: (v) => `⬆ ${v} available`,
      updInstall: 'Install',
      updInstallTitle: 'On a PC, Tampermonkey then shows its update dialog. On iPhone: open the Tampermonkey menu in Safari → "Check for userscript updates".',
      updFailed: 'Check failed',
      miniTitle: 'Open the watchlist (drag to move)',
      apiKey: '🔑 Torn API key',
      apiKeyTitle: 'Set Torn API key',
      apiKeySet: 'set',
      apiKeyMissing: 'missing',
      apiKeyPrompt: 'Torn API key (Public access is enough):',
      updateEvery: 'Update every',
      perMin: (n) => `≈ ${n} requests/min`,
      callsPerUpdate: (n) => `${n} calls per update`,
      ffKey: 'Key',
      ffKeyTitle: 'Set FF Scouter key',
      ffReload: '🔄 Reload FF',
      ffReloadTitle: 'Clear the cache and fetch all FF scores right away (e.g. after the gym)',
      ffKeyPrompt: 'FF Scouter key: a Torn API key registered at ffscouter.com.\nLeave empty to use the watchlist API key.',
      ffOwnKey: 'own key',
      ffWatchlistKey: 'watchlist key',
      ffNoKey: 'no key',
      ffNotRegistered: 'Key not registered with FF Scouter',
      ffUnexpected: 'Unexpected response',
      ffLoading: 'FF Scouter: loads with the next update',
      ffNoData: 'FF Scouter: no data for this player',
      ffLevels: ['extremely easy', 'easy', 'moderate', 'difficult', 'may be impossible'],
      ffStats: (bs) => `Estimated stats: ${bs}`,
      ffAge: (age, old) => `Estimate from ${age} ago${old ? ' (old)' : ''}`,
      chainToggle: '⛓ Chain timer',
      sound: '💣 Bomb sound',
      soundTitle: 'Beeps from 1:30, faster from 0:30, explodes at 0',
      volume: 'Volume',
      soundTestTitle: 'Preview the last seconds + explosion',
      exportTitle: 'Save settings, API key, players and factions to a file',
      importTitle: 'Load settings from an export file (replaces the current ones)',
      importBadJson: 'Import failed: the file is not valid JSON.',
      importNotOurs: 'Import failed: this is not a watchlist export file.',
      importEmpty: 'Import failed: the file contains no settings.',
      importReadFail: 'Import failed: the file could not be read.',
      importConfirm: (p, f, key) => `Import settings?\n\n${p} players, ${f} factions${key ? ', API key' : ''}.\nYour current settings will be replaced.`,
      removeFactionConfirm: (name) => `Remove faction "${name}" from the watchlist?`,
      needKey: 'Please set an API key first (⚙ → Torn API key).',
      searchingFaction: 'Looking up faction…',
      apiError: (e) => `API error: ${e}`,
      error: (e) => `Error: ${e}`,
      notInFaction: 'This player is not in a faction.',
      invalidResponse: 'Invalid response',
      networkError: 'Network error',
      timeout: 'Timeout',
      noFaction: 'No faction',
      notLoaded: 'Not loaded yet',
      needsLimited: 'needs a Limited key',
      traveling: '✈ Traveling',
      abroad: '✈ Abroad',
      lastAction: (age) => `Last action: ${age} ago`,
      remove: 'Remove',
      watchedFaction: 'Faction on the watchlist',
      removeFaction: 'Remove faction from the watchlist',
      noDataYet: 'No data yet – loads with the next update.',
      restoreAll: (n) => `↺ Restore all players of this faction (${n} hidden)`,
      emptyList: 'Nobody on the list yet.',
      onListRemove: '✓ Player is on the list – remove',
      addProfile: (id) => `+ Add player [${id}]`,
      factionOnList: (name) => `✓ Faction ${name} is on the list`,
      addPlayerFaction: (name) => (name ? `+ Add faction ${name}` : "+ Add the player's faction"),
      factionPageOnList: '✓ Faction is on the list – remove',
      addThisFaction: (id) => `+ Add this faction [${id}]`,
      hitsStrip: (n) => `🎯 Today: ${n} hits`,
      hitsTitle: (att, hits, war) => `${att} of your attacks today (since 00:00 TCT), ${hits} of them successful (${war} in the ranked war).\nClick to refresh.`,
      resume: 'Resume API requests',
      pause: 'Pause API requests',
      footPaused: '⏸ API requests paused',
      footNoKey: 'No API key set – ⚙ → Torn API key.',
      footUpdating: 'Updating…',
      footLast: (age) => `Last update ${age} ago`,
      legend: '📖 Legend',
      lgExample: 'Made-up example – this is how rows look in the list',
      lgExampleName: 'Example player',
      lgRows: 'Row color = last action',
      lgGreen: 'Inactive for more than 15 min – probably offline',
      lgOrange: 'Inactive for 10–15 min',
      lgRed: 'Less than 10 min – active right now',
      lgGray: 'No data loaded yet',
      lgStatus: 'Status',
      lgOkay: 'Not in hospital – can be attacked',
      lgHosp: 'In hospital, time left until release',
      lgJail: 'In jail / federal jail, time left',
      lgTravel: 'Currently flying',
      lgAbroad: 'Is abroad',
      lgFF: 'FF score (FF Scouter)',
      lgFFEasy: 'Blue – easy (FF around 1)',
      lgFFMid: 'Green/yellow – moderate',
      lgFFHard: 'Red – difficult (FF 5 and above)',
      lgFFOld: 'Estimate older than 14 days',
      lgFFNone: 'No data at FF Scouter',
      lgFFLoading: 'Loads with the next update',
      lgOther: 'Other',
      lgStar: 'Faction is on the watchlist',
      lgBadges: 'Number of players per row color in the group',
      lgChain: 'Chain timer below 1:30: box blinks red, panel glows red',
      lgRemove: 'Remove player (for factions: hide only)',
      lgRestore: 'Show the hidden players of the faction again',
      lgSort: 'Sorting: players not in hospital come first (longest inactive on top), then by hospital time left.',
      lgHover: 'Tip: hover a row or the FF score for details (last action, estimated stats).',
      warAdd: 'Add to watchlist',
      warOnList: 'On the watchlist – click to remove',
      warCopy: 'Copy name [ID] with profile link',
      warCopied: 'Copied!',
      warCopyFailed: 'Copy failed',
    },
  };
  // English is the default; German only when chosen in the settings
  const getLang = () => (GM_getValue('lang', 'en') === 'de' ? 'de' : 'en');
  function t(key, ...args) {
    const s = I18N[getLang()][key] ?? I18N.en[key];
    return typeof s === 'function' ? s(...args) : s;
  }

  // Backup in torn.com's localStorage: if the Tampermonkey storage is lost or older than the
  // backup, the backup is restored on load. "savedAt" is kept in both stores and decides
  // which one is newer.
  const BACKUP_KEY = 'twl-settings-backup';
  function readBackup() {
    try {
      const b = JSON.parse(localStorage.getItem(BACKUP_KEY) || 'null');
      return isObj(b) && isNum(b.savedAt) && isObj(b.settings) ? b : null;
    } catch {
      return null;
    }
  }
  function saveBackup() {
    clearTimeout(backupTimer);
    backupTimer = null;
    const settings = {};
    for (const k of Object.keys(SETTINGS)) {
      const v = GM_getValue(k, undefined);
      if (v !== undefined) settings[k] = v;
    }
    const savedAt = Date.now();
    GM_setValue('savedAt', savedAt);
    try {
      localStorage.setItem(BACKUP_KEY, JSON.stringify({ savedAt, settings }));
    } catch (e) {
      console.warn('[Watchlist] localStorage backup failed:', e);
    }
  }
  let backupTimer = null;
  const scheduleBackup = () => {
    clearTimeout(backupTimer);
    backupTimer = setTimeout(saveBackup, 1000);
  };
  (function restoreBackup() {
    const b = readBackup();
    const gmAt = GM_getValue('savedAt', 0);
    if (b && b.savedAt > gmAt) {
      for (const k of Object.keys(SETTINGS)) {
        if (k in b.settings && SETTINGS[k](b.settings[k])) GM_setValue(k, b.settings[k]);
      }
      GM_setValue('savedAt', b.savedAt);
    } else if (!b || b.savedAt < gmAt) {
      saveBackup(); // create the first backup or renew an outdated one
    }
  })();
  // Every own change (not those from other tabs) also lands in the backup shortly after
  for (const k of Object.keys(SETTINGS)) {
    GM_addValueChangeListener(k, (_k, _o, _n, remote) => { if (!remote) scheduleBackup(); });
  }
  window.addEventListener('pagehide', () => { if (backupTimer) saveBackup(); });

  function updateEntry(id, patch) {
    const list = getList();
    const entry = list.find((e) => e.id === id);
    if (!entry) return; // removed in the meantime
    Object.assign(entry, patch);
    setList(list);
  }

  function updateFaction(id, patch) {
    const factions = getFactions();
    const f = factions.find((x) => x.id === id);
    if (!f) return; // removed in the meantime
    Object.assign(f, patch);
    setFactions(factions);
  }

  // Player IDs whose data already comes via a watched faction (no call of their own needed)
  function coveredIds(factions) {
    return new Set(factions.flatMap((f) => f.members.map((m) => m.id)));
  }

  function addPlayer(id) {
    // If the player is in a watched faction, just show them there again.
    const factions = getFactions();
    const owners = factions.filter((f) => f.members.some((m) => m.id === id));
    if (owners.length) {
      for (const f of owners) f.hidden = f.hidden.filter((h) => h !== id);
      setFactions(factions);
      render();
      return;
    }
    const list = getList();
    if (list.some((e) => e.id === id)) return;
    list.push({ id, name: null, ts: null, error: null });
    setList(list);
    render();
    const key = getKey();
    if (key && !isPaused()) refreshOne(id, key).then(render);
  }

  // ✕ on a player: delete from the single list and hide in watched factions.
  function removePlayer(id) {
    setList(getList().filter((e) => e.id !== id));
    const factions = getFactions();
    let changed = false;
    for (const f of factions) {
      if (f.members.some((m) => m.id === id) && !f.hidden.includes(id)) {
        f.hidden.push(id);
        changed = true;
      }
    }
    if (changed) setFactions(factions);
    render();
  }

  function addFaction(id, name, tag) {
    const factions = getFactions();
    if (factions.some((f) => f.id === id)) return;
    factions.push({ id, name: name || null, tag: tag || '', hidden: [], members: [], error: null });
    setFactions(factions);
    render();
    const key = getKey();
    if (key && !isPaused()) refreshFaction(id, key).then(render);
  }

  function removeFaction(id) {
    const f = getFactions().find((x) => x.id === id);
    if (!f || !confirm(t('removeFactionConfirm', f.name || id))) return;
    setFactions(getFactions().filter((x) => x.id !== id));
    render();
  }

  function restoreFaction(id) {
    updateFaction(id, { hidden: [] });
    render();
  }

  // ---- Torn API ------------------------------------------------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function apiGet(path, key) {
    const sep = path.includes('?') ? '&' : '?';
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: `https://api.torn.com/${path}${sep}key=${encodeURIComponent(key)}&comment=watchlist`,
        timeout: 15000,
        onload: (r) => {
          try { resolve(JSON.parse(r.responseText)); } catch { reject(new Error(t('invalidResponse'))); }
        },
        onerror: () => reject(new Error(t('networkError'))),
        ontimeout: () => reject(new Error(t('timeout'))),
      });
    });
  }

  // Status from the API (Hospital, Jail, Traveling, …); "until" = when it ends
  const statusOf = (s) => (s ? { state: s.state || '', until: s.until || 0 } : null);

  const profileFaction = (d) => {
    const f = d.faction || {};
    return f.faction_id
      ? { id: f.faction_id, name: f.faction_name, tag: f.faction_tag || '' }
      : { id: 0, name: 'No faction', tag: '' };
  };

  // Single player. Returns the Torn error code (or 0) so the loop can stop on key problems.
  async function refreshOne(id, key) {
    try {
      const d = await apiGet(`user/${id}?selections=profile`, key);
      if (d.error) {
        updateEntry(id, { error: `API: ${d.error.error}` });
        return d.error.code;
      }
      updateEntry(id, {
        name: d.name,
        ts: d.last_action.timestamp,
        status: statusOf(d.status),
        faction: profileFaction(d),
        error: null,
      });
    } catch (e) {
      updateEntry(id, { error: e.message });
    }
    return 0;
  }

  // Whole faction with one call (/v2/faction/{id}/members). The name is fetched only once.
  async function refreshFaction(id, key) {
    try {
      const f = getFactions().find((x) => x.id === id);
      if (!f) return 0;
      if (!f.name) {
        const b = await apiGet(`v2/faction/${id}/basic`, key);
        if (b.error) {
          updateFaction(id, { error: `API: ${b.error.error}` });
          return b.error.code;
        }
        updateFaction(id, { name: b.basic.name, tag: b.basic.tag || '' });
        await sleep(REQUEST_GAP_MS);
      }
      const d = await apiGet(`v2/faction/${id}/members`, key);
      if (d.error) {
        updateFaction(id, { error: `API: ${d.error.error}` });
        return d.error.code;
      }
      const raw = d.members || [];
      const members = (Array.isArray(raw) ? raw : Object.entries(raw).map(([mid, m]) => ({ ...m, id: +mid })))
        .map((m) => ({
          id: m.id,
          name: m.name,
          ts: m.last_action ? m.last_action.timestamp : null,
          status: statusOf(m.status),
        }));
      updateFaction(id, { members, error: null });
    } catch (e) {
      updateFaction(id, { error: e.message });
    }
    return 0;
  }

  // ---- Today's hits: own successful attacks since 00:00 TCT (= UTC) -----------------------
  // Needs a key with Limited access. Counts incrementally: usually just one call per update.
  const HIT_RESULTS = ['Attacked', 'Mugged', 'Hospitalized', 'Arrested', 'Looted', 'Special', 'Bounty'];
  const hitsEnabled = () => GM_getValue('hitsOn', true);
  const todayStart = () => Math.floor(Date.now() / 86400000) * 86400;
  function getHits() {
    const h = GM_getValue('hits', null);
    if (h && h.day === todayStart()) return h;
    return { day: todayStart(), from: todayStart(), ids: [], hits: 0, warHits: 0, attempts: 0, error: null, denied: false };
  }
  let hitsLoading = false;

  async function refreshHits(key) {
    if (hitsLoading) return;
    const h = getHits();
    if (h.denied && GM_getValue('hitsDeniedKey', '') === key) return; // key lacks access – save calls
    hitsLoading = true;
    try {
      // Fetch own player ID once (remembered per key)
      let myId = GM_getValue('myId', null);
      if (!myId || GM_getValue('myIdKey', '') !== key) {
        const me = await apiGet('user/?selections=basic', key);
        if (me.error) throw new Error(`API: ${me.error.error}`);
        myId = me.player_id;
        GM_setValue('myId', myId);
        GM_setValue('myIdKey', key);
        await sleep(REQUEST_GAP_MS);
      }
      const seen = new Set(h.ids);
      for (let page = 0; page < 10; page++) { // load at most 1000 attacks per update
        if (page) await sleep(REQUEST_GAP_MS);
        const d = await apiGet(`v2/user/attacks?filters=outgoing&sort=ASC&limit=100&from=${h.from}`, key);
        if (d.error) {
          h.denied = d.error.code === 16;
          if (h.denied) GM_setValue('hitsDeniedKey', key);
          h.error = h.denied ? t('needsLimited') : `API: ${d.error.error}`;
          break;
        }
        h.denied = false;
        h.error = null;
        const attacks = d.attacks || [];
        let added = 0;
        for (const a of attacks) {
          h.from = Math.max(h.from, a.started || 0);
          if (seen.has(a.id)) continue;
          seen.add(a.id);
          added++;
          if (!a.attacker || a.attacker.id !== myId || (a.started || 0) < h.day) continue;
          h.attempts++;
          if (HIT_RESULTS.includes(a.result)) {
            h.hits++;
            if (a.is_ranked_war) h.warHits++;
          }
        }
        if (attacks.length < 100 || !added) break;
      }
      h.ids = [...seen];
    } catch (e) {
      h.error = e.message;
    } finally {
      hitsLoading = false;
    }
    if (h.day === todayStart()) GM_setValue('hits', h); // day changed during the request? Then discard.
  }

  // ---- FF Scouter: fair fight estimate per player (ffscouter.com) ----------------------------
  // Needs a Torn API key registered at ffscouter.com (own key or the watchlist key). Values
  // change slowly and are cached; FF also depends on your own stats, so refetch after a while.
  const FF_API = 'https://ffscouter.com/api/v1';
  const FF_MAX_AGE_MS = 30 * 60 * 1000;
  const FF_CHUNK = 100;               // players per request
  const FF_OLD_S = 14 * 86400;        // older estimates get a "?"
  const ffEnabled = () => GM_getValue('ffOn', false);
  const getFfKey = () => GM_getValue('ffKey', '') || getKey();
  const getFfCache = () => GM_getValue('ffCache', {});
  let ffLoading = false;

  function ffGet(path) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: `${FF_API}/${path}`,
        timeout: 15000,
        onload: (r) => {
          try { resolve(JSON.parse(r.responseText)); } catch { reject(new Error(`${t('invalidResponse')} (HTTP ${r.status})`)); }
        },
        onerror: () => reject(new Error(t('networkError'))),
        ontimeout: () => reject(new Error(t('timeout'))),
      });
    });
  }

  const ffStale = (ids) => {
    const cache = getFfCache();
    const now = Date.now();
    return ids.filter((id) => !cache[id] || now - cache[id].fetched > FF_MAX_AGE_MS);
  };

  async function refreshFF(ids) {
    const key = getFfKey();
    const stale = ffStale(ids);
    if (!key || ffLoading || !stale.length) return;
    ffLoading = true;
    try {
      for (let i = 0; i < stale.length; i += FF_CHUNK) {
        if (i) await sleep(REQUEST_GAP_MS);
        const chunk = stale.slice(i, i + FF_CHUNK);
        const d = await ffGet(`get-stats?key=${encodeURIComponent(key)}&targets=${chunk.join(',')}`);
        if (!Array.isArray(d)) {
          const code = d && d.code;
          GM_setValue('ffError', code === 6 ? t('ffNotRegistered')
            : `${(d && d.error) || t('ffUnexpected')}${code != null ? ` (Code ${code})` : ''}`);
          return;
        }
        const cache = getFfCache();
        const t = Date.now();
        for (const id of chunk) cache[id] = { ff: null, bs: null, upd: null, fetched: t }; // no data
        for (const r of d) {
          if (r && r.player_id) {
            cache[r.player_id] = { ff: r.fair_fight ?? null, bs: r.bs_estimate_human ?? null, upd: r.last_updated ?? null, fetched: t };
          }
        }
        // drop entries nobody has needed for a day
        for (const id of Object.keys(cache)) if (t - cache[id].fetched > 86400000) delete cache[id];
        GM_setValue('ffCache', cache);
        GM_setValue('ffError', '');
      }
    } catch (e) {
      GM_setValue('ffError', e.message);
    } finally {
      ffLoading = false;
    }
  }

  // All shown players: members of watched factions (without hidden ones) + single players
  function shownIds() {
    const ids = new Set();
    for (const f of getFactions()) {
      const hidden = new Set(f.hidden);
      for (const m of f.members) if (!hidden.has(m.id)) ids.add(m.id);
    }
    for (const e of getList()) ids.add(e.id);
    return [...ids];
  }

  const KEY_ERRORS = [1, 2, 10, 13, 16, 18]; // key missing/wrong/locked/insufficient access
  let refreshing = false;

  async function refreshAll(force) {
    if (refreshing) return;
    const key = getKey();
    if (!key) return;
    // Paused: no automatic requests (⟳ still fetches once manually).
    if (!force && isPaused()) return;
    // Only one tab refreshes per interval, the others get the data via the shared storage.
    if (!force && Date.now() - GM_getValue('lastRefresh', 0) < getRefreshS() * 1000) return;
    GM_setValue('lastRefresh', Date.now());
    refreshing = true;
    render();
    try {
      let calls = 0;
      const next = async () => {
        if (calls++) await sleep(REQUEST_GAP_MS);
        return force || !isPaused(); // paused during a running pass?
      };
      // 1) Factions: one call per faction
      for (const fid of getFactions().map((f) => f.id)) {
        if (!(await next())) return;
        if (KEY_ERRORS.includes(await refreshFaction(fid, key))) return;
      }
      // 2) Single players – except those already covered by a faction
      const covered = coveredIds(getFactions());
      for (const id of getList().map((e) => e.id).filter((pid) => !covered.has(pid))) {
        if (!(await next())) return;
        if (KEY_ERRORS.includes(await refreshOne(id, key))) return;
      }
      // 3) Today's hits (own error, does not stop the watchlist)
      if (hitsEnabled()) {
        if (!(await next())) return;
        await refreshHits(key);
      }
      // 4) FF Scouter (own server, does not count against Torn's limit) – only stale/new players
      if (ffEnabled() && ffStale(shownIds()).length) {
        if (!(await next())) return;
        await refreshFF(shownIds());
      }
    } finally {
      refreshing = false;
      render();
    }
  }

  // ---- Helpers --------------------------------------------------------------
  function currentProfileId() {
    if (location.pathname !== '/profiles.php') return null;
    const id = parseInt(new URLSearchParams(location.search).get('XID'), 10);
    return Number.isFinite(id) ? id : null;
  }

  function currentFactionPageId() {
    if (location.pathname !== '/factions.php') return null;
    const params = new URLSearchParams(location.search);
    if (params.get('step') !== 'profile') return null;
    const id = parseInt(params.get('ID'), 10);
    return Number.isFinite(id) ? id : null;
  }

  // A player's faction, if already known (without an API call)
  const lookedUpFactions = {};
  function knownFactionOf(pid, factions) {
    const f = factions.find((x) => x.members.some((m) => m.id === pid));
    if (f) return { id: f.id, name: f.name, tag: f.tag };
    const e = getList().find((x) => x.id === pid);
    return (e && e.faction) || lookedUpFactions[pid] || null;
  }

  // "+ Add the player's faction": look the faction up with a profile call if needed
  async function addFactionOfPlayer(pid, btn) {
    let fac = knownFactionOf(pid, getFactions());
    if (!fac) {
      const key = getKey();
      if (!key) return alert(t('needKey'));
      btn.disabled = true;
      btn.textContent = t('searchingFaction');
      try {
        const d = await apiGet(`user/${pid}?selections=profile`, key);
        if (d.error) return alert(t('apiError', d.error.error));
        fac = lookedUpFactions[pid] = profileFaction(d);
      } catch (e) {
        return alert(t('error', e.message));
      } finally {
        delete $('.twl-profile').dataset.html; // redraw the button
        render();
      }
    }
    if (!fac.id) return alert(t('notInFaction'));
    addFaction(fac.id, fac.name, fac.tag);
  }

  function formatAge(s) {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
  }

  // Hospital time left in seconds (0 = not in hospital or already out)
  const hospitalLeft = (st, now) => (st && st.state === 'Hospital' && st.until > now ? st.until - now : 0);

  function statusLabel(st, now) {
    if (!st) return '–';
    const left = st.until > now ? st.until - now : 0;
    switch (st.state) {
      case 'Hospital': return left ? `🏥 ${formatAge(left)}` : 'Okay';
      case 'Jail':
      case 'Federal': return left ? `⛓ ${formatAge(left)}` : st.state;
      case 'Traveling': return t('traveling');
      case 'Abroad': return t('abroad');
      default: return st.state || '–';
    }
  }

  const getView = () => (GM_getValue('view', 'list') === 'tiles' ? 'tiles' : 'list');
  // Rough "last action" for the tiles: 3 min / 2 h / 4 d
  function seenLabel(ageS) {
    if (ageS == null) return '';
    if (ageS < 120) return t('seenNow');
    const m = Math.floor(ageS / 60);
    if (m < 60) return t('seen', `${m} min`);
    const h = Math.floor(m / 60);
    return t('seen', h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`);
  }

  function colorClass(ageS) {
    if (ageS == null) return 'twl-unknown';
    if (ageS > GREEN_AFTER_S) return 'twl-green';
    if (ageS >= ORANGE_AFTER_S) return 'twl-orange';
    return 'twl-red';
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---- UI --------------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = `
    #twl-panel { position: fixed; top: 110px; width: 240px; z-index: 999999; font: 12px/1.35 Arial, sans-serif;
      display: flex; flex-direction: column; box-sizing: border-box;
      background: #1b1b1f; color: #eee; border: 1px solid #ff7518; border-radius: 6px; box-shadow: 0 4px 14px rgba(0,0,0,.5); }
    /* Pumpkin-style scrollbars (Chrome/Edge/Safari via ::-webkit-scrollbar, Firefox via scrollbar-color) */
    #twl-panel ::-webkit-scrollbar { width: 8px; height: 8px; }
    #twl-panel ::-webkit-scrollbar-track { background: #15151a; border-radius: 4px; }
    #twl-panel ::-webkit-scrollbar-thumb { background: #a0521a; border: 1px solid #2a1a0e; border-radius: 4px; }
    #twl-panel ::-webkit-scrollbar-thumb:hover { background: #ff7518; }
    #twl-panel ::-webkit-scrollbar-button { display: none; }
    #twl-panel ::-webkit-scrollbar-corner { background: transparent; }
    @supports not selector(::-webkit-scrollbar) {
      #twl-panel * { scrollbar-width: thin; scrollbar-color: #a0521a #15151a; }
    }
    #twl-panel.twl-sized .twl-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    #twl-panel.twl-sized .twl-list { flex: 1; min-height: 0; max-height: none; }
    #twl-panel.twl-sized .twl-main { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    #twl-panel.twl-sized .twl-spage { flex: 1; min-height: 0; max-height: none; }
    .twl-spage { max-height: 70vh; overflow-y: auto; }
    #twl-panel .twl-main[hidden], #twl-panel .twl-spage[hidden] { display: none; }
    /* Resize handles in all four corners; bigger on touch screens */
    .twl-resize { position: absolute; z-index: 2; width: 12px; height: 12px; touch-action: none; opacity: .55; }
    .twl-resize:hover { opacity: 1; }
    .twl-resize[data-corner="tl"] { top: 0; left: 0; cursor: nwse-resize; border-radius: 6px 0 0 0;
      background: linear-gradient(135deg, #ff7518 0 2px, transparent 2px 5px, #ff7518 5px 7px, transparent 7px); }
    .twl-resize[data-corner="tr"] { top: 0; right: 0; cursor: nesw-resize; border-radius: 0 6px 0 0;
      background: linear-gradient(-135deg, #ff7518 0 2px, transparent 2px 5px, #ff7518 5px 7px, transparent 7px); }
    .twl-resize[data-corner="bl"] { bottom: 0; left: 0; cursor: nesw-resize; border-radius: 0 0 0 6px;
      background: linear-gradient(45deg, #ff7518 0 2px, transparent 2px 5px, #ff7518 5px 7px, transparent 7px); }
    .twl-resize[data-corner="br"] { bottom: 0; right: 0; cursor: nwse-resize; border-radius: 0 0 6px 0;
      background: linear-gradient(-45deg, #ff7518 0 2px, transparent 2px 5px, #ff7518 5px 7px, transparent 7px); }
    @media (pointer: coarse) {
      .twl-resize { width: 24px; height: 24px; opacity: .8; }
      .twl-resize[data-corner="tl"], .twl-resize[data-corner="tr"] { width: 16px; height: 16px; } /* don't cover the header buttons */
    }
    #twl-panel.twl-collapsed .twl-resize { display: none; }
    #twl-panel.twl-right { right: 6px; }
    #twl-panel.twl-left { left: 6px; }
    #twl-panel button { background: #333; color: #eee; border: 1px solid #555; border-radius: 3px; cursor: pointer; padding: 1px 6px; font: inherit; }
    #twl-panel button:hover { background: #444; }
    .twl-head { display: flex; align-items: center; gap: 4px; padding: 5px 12px; background: #2a1a0e; border-radius: 6px 6px 0 0;
      cursor: move; user-select: none; touch-action: none; }
    @media (pointer: coarse) { .twl-head { padding: 7px 17px; } } /* room for the bigger corner handles */
    .twl-title { flex: 1; font-weight: bold; color: #ff9a3c; }
    #twl-panel button.twl-hits { display: block; width: 100%; text-align: left; padding: 4px 8px; border: 0;
      border-bottom: 1px solid #5a3a1e; border-radius: 0; background: #22160c; color: #ffcf9e; font-weight: bold; }
    #twl-panel button.twl-hits:hover { background: #2e1d10; }
    .twl-hits-err { color: #ff8080; font-weight: normal; }
    .twl-chain { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px;
      background: #15151a; border-bottom: 1px solid #5a3a1e; }
    .twl-chain-info { display: flex; flex-direction: column; line-height: 1.2; }
    .twl-chain-label { font-size: 10px; color: #999; text-transform: uppercase; letter-spacing: .5px; }
    .twl-chain-val { font-size: 15px; font-weight: bold; color: #ffcf9e; }
    .twl-chain-time { font: bold 28px/1 'Courier New', monospace; color: #fff; font-variant-numeric: tabular-nums; }
    .twl-chain.twl-chain-alert { animation: twl-blink 1s steps(1) infinite; }
    @keyframes twl-blink { 0% { background: #d00000; } 50% { background: #15151a; } }
    #twl-panel.twl-alert { border-color: #ff2020; box-shadow: 0 0 14px 3px rgba(255,0,0,.7); }
    /* Touch screens: a collapsed panel shrinks to a small "P" square – tap to open, drag to move */
    #twl-panel button.twl-mini { display: none; }
    #twl-panel.twl-mini-mode { width: auto !important; height: auto !important; border: 0; background: transparent; box-shadow: none; }
    #twl-panel.twl-mini-mode > :not(.twl-mini) { display: none !important; }
    #twl-panel.twl-mini-mode > button.twl-mini { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px;
      padding: 0; border-radius: 8px; border: 2px solid #2a1a0e; background: #ff7518; color: #fff;
      font: bold 20px/1 Arial, sans-serif; box-shadow: 0 2px 8px rgba(0,0,0,.6); touch-action: none; }
    /* Header mode: button after Torn's ☰ menu, panel inline below the header in full screen height */
    .twl-hbtn { position: absolute; z-index: 2147483000; pointer-events: auto !important; touch-action: manipulation; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box;
      height: 30px; min-width: 30px; padding: 0 7px; margin: 0; border-radius: 6px; border: 2px solid #2a1a0e;
      background: #ff7518; color: #fff; font: bold 17px/1 Arial, sans-serif; white-space: nowrap; cursor: pointer;
      -webkit-tap-highlight-color: transparent; }
    .twl-hbtn.twl-hbtn-open { background: #c4560f; box-shadow: inset 0 2px 4px rgba(0,0,0,.4); }
    .twl-htimer { position: absolute; z-index: 2147483000; display: none; align-items: center; box-sizing: border-box; height: 30px;
      padding: 0 7px; border-radius: 6px; border: 2px solid #2a1a0e; background: #ff7518; color: #fff;
      font: bold 14px/1 Arial, sans-serif; white-space: nowrap; pointer-events: none; }
    .twl-htimer.twl-on { display: inline-flex; }
    .twl-htimer.twl-compact { font-size: 12px; padding: 0 4px; }
    .twl-htimer.twl-alert { background: #d00000; box-shadow: 0 0 10px 2px rgba(255,0,0,.8); animation: twl-blink 1s steps(1) infinite; }
    /* Same badge on a profile page: FF score, dark with the FF color (text + border) */
    .twl-htimer.twl-ffbadge { background: #1b1b1f; border-color: currentColor; animation: none; box-shadow: none; }
    .twl-htimer.twl-ffbadge.twl-alert-ring { box-shadow: 0 0 10px 2px rgba(255,0,0,.8); }
    #twl-panel.twl-inline { position: relative !important; left: auto !important; top: auto !important; right: auto !important;
      width: auto !important; margin: 6px; z-index: 5;
      /* Fills the screen below Torn's header (--twl-top = where the panel starts), so it ends above
         Safari's bottom address bar instead of running under it */
      height: max(260px, calc(100vh - var(--twl-top, 0px) - 6px)) !important;
      height: max(260px, calc(100dvh - var(--twl-top, 0px) - 6px)) !important; }
    #twl-panel.twl-inline.twl-collapsed, #twl-panel.twl-wait { display: none !important; }
    #twl-panel.twl-inline .twl-resize, #twl-panel.twl-inline button.twl-mini { display: none !important; }
    #twl-panel.twl-inline .twl-head { cursor: default; }
    #twl-panel.twl-inline [data-act="side"] { display: none; } /* docking makes no sense inline */
    /* Chain alarm also shows on the square */
    #twl-panel.twl-mini-mode.twl-alert > button.twl-mini { background: #d00000; box-shadow: 0 0 12px 3px rgba(255,0,0,.8);
      animation: twl-blink 1s steps(1) infinite; }
    #twl-panel.twl-collapsed .twl-body { display: none; }
    .twl-body { padding: 6px; }
    .twl-profile { display: flex; flex-direction: column; gap: 4px; margin-bottom: 6px; }
    .twl-profile:empty { display: none; }
    .twl-profile button { width: 100%; padding: 4px; }
    #twl-panel button:disabled { opacity: .6; cursor: default; }
    .twl-add { display: flex; gap: 4px; margin-bottom: 6px; }
    .twl-add input { flex: 1; min-width: 0; background: #111; color: #eee; border: 1px solid #555; border-radius: 3px; padding: 2px 4px; font: inherit; }
    .twl-list { max-height: 60vh; overflow-y: auto; }
    .twl-row { display: flex; align-items: center; gap: 6px; padding: 4px 6px; margin-bottom: 3px; border-radius: 4px;
      color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.9); }
    /* Torn colors links itself (partly red) – so force it here. */
    #twl-panel .twl-row a, #twl-panel .twl-row a:link, #twl-panel .twl-row a:visited,
    #twl-panel .twl-row a:hover, #twl-panel .twl-row a:active { color: #fff !important; text-decoration: none; font-weight: bold; }
    #twl-panel .twl-row a:hover { text-decoration: underline; }
    #twl-panel .twl-row .twl-id, #twl-panel .twl-row .twl-age { color: #fff !important; }
    .twl-who { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .twl-id { opacity: .8; font-weight: normal; }
    .twl-age { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .twl-ff { min-width: 34px; padding: 0 4px; border-radius: 3px; text-align: center; font-size: 11px; font-weight: bold;
      font-variant-numeric: tabular-nums; white-space: nowrap; background: #333; border: 1px solid rgba(0,0,0,.5); }
    .twl-ff-none { color: #bbb; font-weight: normal; }
    .twl-ff-err { color: #ff8080; }
    .twl-row button.twl-x { padding: 0 5px; background: rgba(0,0,0,.25); border-color: rgba(255,255,255,.3); }
    .twl-green { background: #1f7a35; }
    .twl-orange { background: #c76a00; }
    .twl-red { background: #a3191c; }
    .twl-unknown { background: #444; }
    .twl-err { font-size: 10px; color: #ffd0d0; }
    .twl-group { margin-bottom: 4px; }
    .twl-ghead { display: flex; gap: 3px; margin-bottom: 3px; }
    #twl-panel button.twl-gtoggle { flex: 1; min-width: 0; display: flex; align-items: center; gap: 5px; text-align: left;
      padding: 3px 5px; background: #2a1a0e; border-color: #5a3a1e; }
    #twl-panel button.twl-gtoggle:hover { background: #3a2412; }
    #twl-panel button.twl-gx { padding: 0 5px; background: #2a1a0e; border-color: #5a3a1e; }
    .twl-star { color: #ff9a3c; }
    .twl-gnote { font-size: 10px; color: #999; margin: 0 0 3px; }
    #twl-panel button.twl-restore { width: 100%; margin-bottom: 3px; font-size: 11px; background: #252530; }
    .twl-caret { width: 10px; color: #ff9a3c; }
    .twl-gname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: bold; color: #ffcf9e; }
    .twl-gtag { opacity: .7; font-weight: normal; }
    .twl-gcount { color: #999; }
    .twl-badges { display: flex; gap: 2px; }
    .twl-b { min-width: 10px; padding: 0 4px; border-radius: 7px; text-align: center; font-size: 10px; color: #fff; }
    .twl-grows { padding-left: 6px; border-left: 2px solid #5a3a1e; margin-left: 4px; }
    .twl-foot { display: flex; justify-content: space-between; gap: 6px; margin-top: 4px; font-size: 10px; color: #999; }
    .twl-foot-rate { white-space: nowrap; font-weight: normal; color: #999; }
    .twl-foot-rate.twl-warn { color: #ff9a3c; }
    .twl-settings { display: flex; align-items: center; gap: 4px; margin-top: 4px; font-size: 11px; color: #bbb; flex-wrap: wrap; }
    .twl-settings input { width: 48px; background: #111; color: #eee; border: 1px solid #555; border-radius: 3px; padding: 1px 3px; font: inherit; }
    #twl-panel button.twl-pause.twl-off { background: #a3191c; border-color: #ff5a5a; }
    .twl-foot.twl-off { color: #ff8080; font-weight: bold; }
    .twl-settings input[type="checkbox"] { width: auto; margin: 0; }
    .twl-settings label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
    .twl-spage .twl-settings { margin-top: 0; padding: 6px 2px; border-bottom: 1px solid #333; }
    .twl-sp-head { display: flex; align-items: center; gap: 8px; padding-bottom: 6px; border-bottom: 1px solid #5a3a1e; color: #ff9a3c; }
    .twl-settings select { background: #111; color: #eee; border: 1px solid #555; border-radius: 3px; padding: 1px 3px; font: inherit; }
    .twl-key-status { color: #999; }
    .twl-upd-status { color: #999; }
    .twl-upd-status.twl-upd-new { color: #ff9a3c; font-weight: bold; }
    #twl-panel .twl-upd-status a { color: #ffcf9e; text-decoration: underline; }
    .twl-legend { padding: 6px 2px; }
    .twl-legend summary { cursor: pointer; color: #ffcf9e; font-weight: bold; }
    .twl-lg-ex { margin: 6px 0 2px; font-size: 10px; color: #999; }
    .twl-lg-h { margin: 8px 0 3px; color: #ff9a3c; font-weight: bold; font-size: 11px; }
    .twl-lg-note { margin: -1px 0 5px 4px; font-size: 10px; color: #bbb; }
    .twl-lg-grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; align-items: center; font-size: 11px; color: #ccc; }
    .twl-lg-chip { padding: 1px 5px; border-radius: 3px; background: #333; color: #fff; white-space: nowrap; text-align: center;
      font-variant-numeric: tabular-nums; }
    .twl-lg-chip.twl-lg-alert { background: #d00000; }
    .twl-legend .twl-row { margin-bottom: 1px; }
    .twl-lg-text { margin-top: 6px; font-size: 10px; color: #bbb; }
    .twl-key-status.twl-ff-err { color: #ff8080; }
    #twl-panel button.twl-settings-btn.twl-on { background: #5a3a1e; border-color: #ff9a3c; }
    .twl-settings input[type="range"] { width: 70px; padding: 0; background: none; border: 0; accent-color: #ff7518; }
    #twl-panel.twl-boom { animation: twl-shake .1s linear 10; }
    @keyframes twl-shake { 25% { translate: -4px 2px; } 50% { translate: 3px -3px; } 75% { translate: -2px -2px; } }
    #twl-flash { position: fixed; inset: 0; z-index: 1000002; pointer-events: none;
      background: radial-gradient(circle, rgba(255,240,180,.9), rgba(255,120,0,.6) 40%, rgba(120,0,0,.3)); animation: twl-flash 1.2s ease-out forwards; }
    @keyframes twl-flash { from { opacity: 1; } to { opacity: 0; } }
    #twl-nyan { position: fixed; left: 0; top: 0; width: 34px; height: 20px; z-index: 1000001;
      pointer-events: none; display: none; will-change: transform, opacity; }
    #twl-nyan svg { position: absolute; left: 0; top: 0; animation: twl-bob .3s steps(2) infinite; }
    @keyframes twl-bob { 50% { transform: translateY(-1px); } }
    #twl-nyan-trail { position: fixed; left: 0; top: 0; z-index: 1000000; pointer-events: none; display: none; }
    #twl-nyan-trail .twl-rb { position: absolute; left: 0; top: 0; width: 5px; height: 15px; will-change: transform, opacity;
      background: linear-gradient(#ff0000 0 16.66%, #ff9900 0 33.33%, #ffff00 0 50%, #33ff00 0 66.66%, #0099ff 0 83.33%, #6633ff 0); }
    /* Settings: grid of tiles. The old checkbox rows stay hidden in the page – the tiles drive them */
    #twl-panel .twl-s-old { display: none; }
    .twl-sec { margin: 12px 0 6px; color: #999; font-size: 10px; text-transform: uppercase; letter-spacing: .8px; font-weight: bold; }
    .twl-tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
    .twl-tiles.twl-tiles-2 { grid-template-columns: repeat(2, 1fr); }
    #twl-panel button.twl-tile { position: relative; min-height: 68px; margin: 0; padding: 6px 4px; border-radius: 8px;
      background: #26262c; border: 1px solid #3a3a42; color: #bbb; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 4px; text-align: center; font: inherit;
      -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
    #twl-panel button.twl-tile:active { transform: scale(.96); }
    @media (hover: hover) {
      #twl-panel button.twl-tile:hover:not(:disabled) { border-color: #6a6a74; filter: brightness(1.12); }
      #twl-panel button.twl-tile.twl-on:hover { border-color: #ff9a3c; }
      #twl-panel .twl-seg button:not(.twl-on):hover { background: #303038; color: #eee; }
    }
    #twl-panel button.twl-tile:disabled { opacity: .45; }
    .twl-tile .twl-ic { font-size: 20px; line-height: 1; }
    .twl-tile .twl-lb { font-size: 11px; font-weight: bold; line-height: 1.15; }
    .twl-tile .twl-pill { position: absolute; top: 4px; right: 5px; padding: 1px 4px; border-radius: 6px;
      font-size: 8px; font-weight: bold; background: #3a3a42; color: #999; }
    #twl-panel button.twl-tile.twl-on { background: linear-gradient(#3a230f, #2a1a0e); border-color: #ff7518; color: #ffcf9e;
      box-shadow: inset 0 0 0 1px rgba(255, 117, 24, .25); }
    .twl-tile.twl-on .twl-pill { background: #ff7518; color: #fff; }
    #twl-panel button.twl-tile.twl-act { background: #22222a; border-style: dashed; }
    .twl-tile .twl-sub { font-size: 9px; color: #8f8; }
    .twl-tile .twl-sub.twl-ff-err { color: #ff8080; }
    .twl-seg { display: flex; border: 1px solid #555; border-radius: 6px; overflow: hidden; }
    #twl-panel .twl-seg button { flex: 1; margin: 0; padding: 9px 0; border: 0; border-right: 1px solid #444; border-radius: 0;
      background: #26262c; color: #bbb; font: bold 12px Arial, sans-serif; touch-action: manipulation; }
    #twl-panel .twl-seg button:last-child { border-right: 0; }
    #twl-panel .twl-seg button.twl-on { background: #ff7518; color: #fff; }
    .twl-hint { margin-top: 4px; text-align: right; font-size: 10px; color: #999; }
    .twl-hint.twl-warn { color: #ff9a3c; }
    .twl-vol { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px;
      background: #26262c; border: 1px solid #3a3a42; }
    #twl-panel .twl-vol input { flex: 1; min-width: 0; accent-color: #ff7518; }
    #twl-panel .twl-vol button { padding: 6px 10px; font-weight: bold; }
    #twl-panel .twl-s-ver { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; border: 0; }
    #twl-panel .twl-s-ver .twl-version, #twl-panel .twl-s-ver .twl-upd-status {
      display: flex; align-items: center; min-height: 40px; padding: 0 12px; border-radius: 8px 0 0 8px;
      background: #26262c; border: 1px solid #3a3a42; border-right: 0; color: #ddd; font-size: 13px; font-weight: bold; }
    #twl-panel .twl-s-ver .twl-version { flex: 1; }
    #twl-panel .twl-s-ver .twl-upd-status { order: 1; margin-left: -6px; border-radius: 0 8px 8px 0;
      border-left: 0; border-right: 1px solid #3a3a42; font-size: 11px; font-weight: normal; color: #8f8; }
    #twl-panel .twl-s-ver .twl-upd-status:empty { padding: 0 6px; }
    #twl-panel .twl-s-ver .twl-upd-status.twl-upd-new { color: #ff9a3c; font-weight: bold; }
    #twl-panel .twl-s-ver .twl-upd-status.twl-ff-err { color: #ff8080; }
    #twl-panel .twl-s-ver [data-act="update-check"] { order: 2; flex-basis: 100%; min-height: 40px;
      border-radius: 8px; background: #26262c; border-color: #3a3a42; color: #ffcf9e; font-weight: bold; font-size: 13px; }
    #twl-panel .twl-legend { margin: 0; padding: 0 12px; border-radius: 8px; background: #1f1f24; border: 1px solid #3a3a42; }
    #twl-panel .twl-legend summary { padding: 11px 0; }
    #twl-panel .twl-legend[open] { padding-bottom: 10px; }
    #twl-panel .twl-spage { padding-bottom: 8px; }
    /* Header buttons: real refresh icon; on touch the dock button is gone, collapse too when the header P toggles */
    .twl-refresh svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.6;
      stroke-linecap: round; stroke-linejoin: round; vertical-align: -2px; }
    /* Pause lives in the settings grid on touch screens */
    #twl-panel.twl-touch .twl-head [data-act="side"], #twl-panel.twl-touch .twl-head .twl-pause,
    #twl-panel.twl-touch.twl-inline .twl-head [data-act="collapse"] { display: none; }
    #twl-panel.twl-touch .twl-head button.twl-refresh, #twl-panel.twl-touch .twl-head button.twl-settings-btn {
      display: inline-flex; align-items: center; justify-content: center; min-width: 32px; height: 28px; font-size: 15px; }
    #twl-panel.twl-touch .twl-head .twl-refresh svg { width: 16px; height: 16px; vertical-align: 0; }
    /* Tile view of the list: 2 columns, tap = profile, long press / right click = action menu */
    .twl-seen { display: none; }
    .twl-list.twl-view-tiles .twl-grows { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; padding-left: 4px; }
    .twl-list.twl-view-tiles .twl-grows > :not(.twl-row) { grid-column: 1 / -1; }
    .twl-list.twl-view-tiles .twl-row { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas: "who ff" "age seen"; align-items: center; gap: 6px 4px; min-height: 54px; margin: 0;
      padding: 6px 7px; border-radius: 7px; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
      touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
    .twl-list.twl-view-tiles .twl-row:active { filter: brightness(1.15); }
    .twl-view-tiles .twl-who { grid-area: who; font-size: 12.5px; }
    .twl-view-tiles .twl-who .twl-id, .twl-view-tiles .twl-x { display: none; }
    .twl-view-tiles .twl-who a { -webkit-touch-callout: none; }
    .twl-view-tiles .twl-who a::after { content: ""; position: absolute; inset: 0; } /* whole tile opens the profile */
    .twl-view-tiles .twl-ff { grid-area: ff; text-shadow: none; }
    .twl-view-tiles .twl-age { grid-area: age; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 11px; }
    .twl-view-tiles .twl-seen { display: block; grid-area: seen; font-size: 10px; opacity: .75; white-space: nowrap; }
    .twl-view-tiles .twl-row.twl-green { background: linear-gradient(#24893d, #1a6a2e); }
    .twl-view-tiles .twl-row.twl-orange { background: linear-gradient(#d97700, #ad5c00); }
    .twl-view-tiles .twl-row.twl-red { background: linear-gradient(#b51f22, #8c1518); }
    .twl-view-tiles .twl-row.twl-hosp { box-shadow: inset 0 0 0 2px rgba(255, 255, 255, .55); }
    .twl-pmenu { position: absolute; z-index: 10; min-width: 150px; padding: 4px; border: 1px solid #ff7518; border-radius: 8px;
      background: #1b1b1f; box-shadow: 0 6px 20px rgba(0, 0, 0, .8); }
    .twl-pmenu[hidden] { display: none; }
    .twl-pm-title { padding: 4px 6px 6px; color: #ffcf9e; font-weight: bold; white-space: nowrap; }
    .twl-pm-title span { color: #999; font-weight: normal; }
    #twl-panel .twl-pmenu button { display: block; width: 100%; margin-top: 3px; padding: 8px 10px; border-radius: 6px;
      text-align: left; font-weight: bold; background: #26262c; border-color: #3a3a42; }
    #twl-panel .twl-pmenu button[data-act="menu-remove"] { color: #ff9a9a; }
    /* Tabs: watchlist | honors */
    .twl-tabs { display: flex; border-bottom: 1px solid #5a3a1e; background: #1b1b1f; }
    #twl-panel.twl-collapsed .twl-tabs { display: none; }
    #twl-panel .twl-tabs button { flex: 1; margin: 0; padding: 5px 0; border: 0; border-radius: 0; background: transparent;
      color: #999; font-weight: bold; white-space: nowrap; }
    #twl-panel .twl-tabs button:hover { color: #ddd; }
    #twl-panel .twl-tabs button.twl-on { color: #ffcf9e; background: #22160c; box-shadow: inset 0 -2px 0 #ff7518; }
    #twl-panel.twl-touch .twl-tabs button { padding: 9px 0; font-size: 13px; }
    /* Honor tracker */
    #twl-panel .twl-honors[hidden] { display: none !important; } /* else the sized flex rule below wins */
    #twl-panel.twl-sized .twl-honors { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .twl-honors > .twl-seg { margin: 2px 0 6px; }
    .twl-hon-list { max-height: 60vh; overflow-y: auto; }
    #twl-panel.twl-sized .twl-hon-list { flex: 1; min-height: 0; max-height: none; }
    .twl-hon-pills { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
    .twl-hon-pills[hidden] { display: none; }
    .twl-hon-pills.twl-chips { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 4px; }
    #twl-panel .twl-hpill { margin: 0; padding: 2px 8px; border-radius: 10px; border: 1px solid #44444c; background: transparent;
      color: var(--c, #bbb); font-size: 11px; font-weight: bold; white-space: nowrap; touch-action: manipulation; }
    #twl-panel .twl-hpill.twl-on { border-color: var(--c, #ff7518); background: #2a1a0e; color: var(--c, #ffcf9e); }
    .twl-hpill-n { font-weight: normal; opacity: .75; }
    #twl-panel.twl-touch .twl-hpill { padding: 5px 10px; font-size: 12px; }
    .twl-hon-ctrl { display: flex; gap: 4px; margin-bottom: 6px; }
    .twl-hon-ctrl input, .twl-hon-ctrl select { min-width: 0; background: #111; color: #eee; border: 1px solid #555;
      border-radius: 4px; padding: 3px 5px; font: inherit; }
    .twl-hon-ctrl input { flex: 1; }
    #twl-panel.twl-touch .twl-hon-ctrl input, #twl-panel.twl-touch .twl-hon-ctrl select { padding: 6px 7px; font-size: 16px; }
    .twl-hon-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: 6px; font-size: 11px; color: #999; }
    .twl-hon-status { flex: 1 1 140px; min-width: 0; }
    .twl-hs-e { color: #4ade80; font-weight: bold; }
    .twl-hs-m { color: #ff8080; }
    #twl-panel .twl-hon-sub button { padding: 1px 6px; font-size: 10px; white-space: nowrap; }
    #twl-panel .twl-hon-sub button.twl-on { border-color: #ff9a3c; color: #ffcf9e; }
    #twl-panel .twl-hon-sub button.twl-hon-sync { background: #ff7518; border-color: #ff9a3c; color: #fff; font-weight: bold; }
    #twl-panel.twl-touch .twl-hon-sub button { padding: 5px 8px; font-size: 11px; }
    .twl-hon-msg { padding: 16px 6px; text-align: center; color: #999; }
    #twl-panel button.twl-hon-tier { display: flex; align-items: baseline; gap: 6px; width: 100%; margin: 8px 0 5px; padding: 4px 7px;
      border: 0; border-radius: 5px; font-size: 11px; text-align: left; cursor: pointer; touch-action: manipulation; }
    #twl-panel button.twl-hon-tier:hover { filter: brightness(1.25); }
    #twl-panel.twl-touch button.twl-hon-tier { padding: 8px 9px; }
    .twl-hon-tier .twl-caret { width: 9px; }
    .twl-hon-tier b { text-transform: uppercase; letter-spacing: .6px; }
    .twl-hon-tier small { flex: 1; min-width: 0; opacity: .7; font-size: 10px; }
    .twl-hon-tier span { white-space: nowrap; opacity: .8; font-size: 10px; }
    .twl-hc { margin-bottom: 5px; padding: 6px 8px; border-radius: 7px; background: #24242a; border: 1px solid #34343c;
      border-left: 3px solid var(--c); }
    /* Soft glow from the left in the card's own color (older browsers without color-mix keep the plain one) */
    .twl-hc { background: linear-gradient(to right, color-mix(in srgb, var(--c) 22%, transparent), transparent 150px), #24242a; }
    /* Contain inner margins so the fold animation ends exactly at the real height */
    .twl-grows, .twl-hon-group, .twl-hc-guide { display: flow-root; }
    .twl-hc.twl-hc-earned { border-color: rgba(74, 222, 128, .25); border-left-color: #4ade80; }
    .twl-hc.twl-hc-dim { opacity: .45; }
    .twl-hc-bar { display: block; width: 200px; max-width: 100%; height: auto; margin-top: 5px; border-radius: 2px; }
    .twl-hc-name { color: #eee; font-weight: bold; }
    .twl-hc-earned .twl-hc-name { color: #4ade80; }
    .twl-hc-desc { margin-top: 1px; color: #aaa; font-size: 11px; line-height: 1.35; }
    .twl-hc-badges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
    .twl-hb { padding: 1px 6px; border-radius: 8px; background: #2e2e36; font-size: 10px; font-weight: bold; }
    .twl-hp { margin-top: 5px; }
    .twl-hp-l { display: flex; justify-content: space-between; gap: 6px; margin-bottom: 2px; font-size: 10px; color: #999; }
    .twl-hp-bar { height: 4px; border-radius: 2px; background: #333; overflow: hidden; }
    .twl-hp-bar i { display: block; height: 100%; min-width: 2px; border-radius: 2px; }
    .twl-hp-sub { margin-top: 2px; font-size: 10px; color: #777; }
    .twl-hc-acts { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
    #twl-panel .twl-hc-acts button { padding: 2px 7px; border-radius: 5px; background: #2e2e36; border-color: #44444c; font-size: 11px; }
    #twl-panel .twl-hc-acts button.twl-hc-gbtn { margin-right: auto; color: #ff9a3c; }
    #twl-panel.twl-touch .twl-hc-acts button { min-height: 32px; padding: 4px 10px; font-size: 12px; }
    .twl-hc-guide { margin-top: 6px; padding: 6px 8px; border-left: 2px solid #ff7518; background: #1e1e24; color: #c8d0dc;
      font-size: 11.5px; line-height: 1.5; }
    .twl-hc-guide .twl-hb { display: inline-block; margin-bottom: 4px; }
    .twl-rate { color: #999; }
    .twl-rate.twl-warn { color: #ff9a3c; }
    .twl-empty { color: #999; padding: 4px 0; }
    /* Buttons in Torn's ranked war member list (outside the panel) */
    /* Hidden until the row is hovered, then floats over the right end of the name cell like a tooltip */
    .twl-war-cell { position: relative; }
    .twl-war-actions { position: absolute; right: 2px; top: 50%; transform: translateY(-50%); z-index: 5;
      display: inline-flex; gap: 3px; padding: 2px; border: 1px solid #ff7518; border-radius: 4px;
      background: rgba(27, 27, 31, .95); box-shadow: 0 2px 8px rgba(0, 0, 0, .7);
      opacity: 0; pointer-events: none; transition: opacity .12s; }
    li:hover > .twl-war-cell > .twl-war-actions, .twl-war-actions:focus-within { opacity: 1; pointer-events: auto; }
    /* Touch screens have no hover – always show the buttons there */
    @media (hover: none) { .twl-war-actions { opacity: 1; pointer-events: auto; } }
    .twl-war-btn { box-sizing: border-box; width: 18px; height: 18px; padding: 0; display: inline-flex; align-items: center;
      justify-content: center; border-radius: 3px; border: 1px solid #5a3a1e; background: #2a1a0e; color: #ff9a3c;
      font: bold 13px/1 Arial, sans-serif; cursor: pointer; }
    .twl-war-btn:hover { background: #ff7518; border-color: #ff7518; color: #fff; }
    .twl-war-btn.twl-on { background: #1f7a35; border-color: #2ea44f; color: #fff; }
    .twl-war-btn.twl-on:hover { background: #a3191c; border-color: #ff5a5a; }
    .twl-war-btn svg { width: 11px; height: 11px; fill: none; stroke: currentColor; stroke-width: 2; }
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'twl-panel';
  panel.innerHTML = `
    <button type="button" class="twl-mini" data-i18n-title="miniTitle">P</button>
    <div class="twl-head">
      <span class="twl-title" data-i18n-title="dragHint">🎃 <span class="twl-title-name">Watchlist</span> <span class="twl-count"></span></span>
      <button data-act="pause" class="twl-pause"></button>
      <button data-act="refresh" class="twl-refresh" data-i18n-title="refreshNow"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg></button>
      <button data-act="settings" class="twl-settings-btn" data-i18n-title="settings">⚙</button>
      <button data-act="side" data-i18n-title="dock">⇄</button>
      <button data-act="collapse" data-i18n-title="collapse">–</button>
    </div>
    <div class="twl-tabs">
      <button type="button" data-act="tab" data-v="list" data-i18n="tabWatchlist"></button>
      <button type="button" data-act="tab" data-v="honors" class="twl-tab-hon"></button>
    </div>
    <button class="twl-hits" data-act="hits"></button>
    <div class="twl-chain" style="display:none">
      <div class="twl-chain-info">
        <span class="twl-chain-label">⛓ Chain</span>
        <span class="twl-chain-val"></span>
      </div>
      <span class="twl-chain-time"></span>
    </div>
    <div class="twl-body">
      <div class="twl-main">
        <div class="twl-profile"></div>
        <div class="twl-add">
          <input type="text" inputmode="numeric" placeholder="ID" />
          <button data-act="add-input" data-i18n="addPlayer" data-i18n-title="addPlayerTitle"></button>
          <button data-act="add-input-faction" data-i18n="addFaction" data-i18n-title="addFactionTitle"></button>
        </div>
        <div class="twl-list"></div>
      </div>
      <div class="twl-honors" hidden>
        <div class="twl-seg">
          <button type="button" data-act="hon-mode" data-v="easy" data-i18n="honModeEasy"></button>
          <button type="button" data-act="hon-mode" data-v="cat" data-i18n="honModeCat"></button>
          <button type="button" data-act="hon-mode" data-v="all" data-i18n="honModeAll"></button>
        </div>
        <div class="twl-hon-pills"></div>
        <div class="twl-hon-ctrl">
          <input type="search" class="twl-hon-search" data-i18n-ph="honSearch" autocomplete="off" />
          <select class="twl-hon-sort">
            <option value="diff" data-i18n="honSortDiff"></option>
            <option value="rarity" data-i18n="honSortRarity"></option>
            <option value="name" data-i18n="honSortName"></option>
          </select>
        </div>
        <div class="twl-hon-sub">
          <span class="twl-hon-status"></span>
          <button type="button" data-act="hon-sync" class="twl-hon-sync" data-i18n="honSync" data-i18n-tip="honSyncTitle"></button>
          <button type="button" data-act="hon-earned"></button>
          <button type="button" data-act="hon-hidden"></button>
        </div>
        <div class="twl-hon-list"></div>
      </div>
      <div class="twl-spage" hidden>
        <div class="twl-sp-head">
          <button data-act="settings" data-i18n="back"></button>
          <b data-i18n="settings"></b>
        </div>
        <div class="twl-sgrid">
          <div class="twl-sec" data-i18n="secFeatures"></div>
          <div class="twl-tiles">
            <button type="button" class="twl-tile" data-act="tile" data-for=".twl-chain-toggle" data-i18n-tip="chainTip"><span class="twl-pill"></span><span class="twl-ic">⛓</span><span class="twl-lb" data-i18n="tileChain"></span></button>
            <button type="button" class="twl-tile" data-act="tile" data-for=".twl-ff-toggle" data-i18n-tip="ffTip"><span class="twl-pill"></span><span class="twl-ic">📊</span><span class="twl-lb">FF Scouter</span></button>
            <button type="button" class="twl-tile" data-act="tile" data-for=".twl-hits-toggle" data-i18n-tip="hitsTip"><span class="twl-pill"></span><span class="twl-ic">🎯</span><span class="twl-lb">Today's Hits</span></button>
            <button type="button" class="twl-tile" data-act="tile" data-for=".twl-sound-toggle" data-i18n-tip="soundTitle"><span class="twl-pill"></span><span class="twl-ic">💣</span><span class="twl-lb" data-i18n="tileSound"></span></button>
            <button type="button" class="twl-tile" data-act="tile" data-for=".twl-nyan-toggle" data-i18n-tip="nyanTip"><span class="twl-pill"></span><span class="twl-ic">🌈</span><span class="twl-lb">Nyan Cat</span></button>
            <button type="button" class="twl-tile" data-act="pause" data-tile="pause" data-i18n-tip="pauseTip"><span class="twl-pill"></span><span class="twl-ic">⏸</span><span class="twl-lb" data-i18n="tilePaused"></span></button>
          </div>
          <div class="twl-sec" data-i18n="secKeys"></div>
          <div class="twl-tiles">
            <button type="button" class="twl-tile twl-act" data-act="key" data-i18n-tip="apiKeyTitle"><span class="twl-ic">🔑</span><span class="twl-lb" data-i18n="tileApiKey"></span><span class="twl-sub twl-g-key"></span></button>
            <button type="button" class="twl-tile twl-act" data-act="ff-key" data-i18n-tip="ffKeyTitle"><span class="twl-ic">🔑</span><span class="twl-lb" data-i18n="tileFfKey"></span><span class="twl-sub twl-g-ffkey"></span></button>
            <button type="button" class="twl-tile twl-act twl-g-ffreload" data-act="ff-reload" data-i18n-tip="ffReloadTitle"><span class="twl-ic">🔄</span><span class="twl-lb" data-i18n="tileFfReload"></span></button>
          </div>
          <div class="twl-sec" data-i18n="language"></div>
          <div class="twl-seg">
            <button type="button" data-act="seg-lang" data-v="de">Deutsch</button>
            <button type="button" data-act="seg-lang" data-v="en">English</button>
          </div>
          <div class="twl-sec" data-i18n="secView"></div>
          <div class="twl-seg">
            <button type="button" data-act="seg-view" data-v="list">☰ <span data-i18n="viewList"></span></button>
            <button type="button" data-act="seg-view" data-v="tiles">▦ <span data-i18n="viewTiles"></span></button>
          </div>
          <div class="twl-sec" data-i18n="secInterval"></div>
          <div class="twl-seg">
            ${REFRESH_PRESETS.map((v) => `<button type="button" data-act="seg-interval" data-v="${v}">${v < 60 ? `${v} s` : `${v / 60} min`}</button>`).join('')}
          </div>
          <div class="twl-hint twl-g-rate"></div>
          <div class="twl-g-sound">
            <div class="twl-sec" data-i18n="tileSound"></div>
            <div class="twl-vol">🔈<input type="range" class="twl-g-vol" min="0" max="100" step="5" />🔊<button type="button" data-act="sound-test">▶ Test</button></div>
          </div>
          <div class="twl-sec" data-i18n="secData"></div>
          <div class="twl-tiles twl-tiles-2">
            <button type="button" class="twl-tile twl-act" data-act="export" data-i18n-tip="exportTitle"><span class="twl-ic">⬇</span><span class="twl-lb">Export</span></button>
            <button type="button" class="twl-tile twl-act" data-act="import" data-i18n-tip="importTitle"><span class="twl-ic">⬆</span><span class="twl-lb">Import</span></button>
          </div>
          <div class="twl-sec">Version</div>
        </div>
        <div class="twl-settings twl-s-old">
          <span data-i18n="language"></span>
          <select class="twl-lang"><option value="de">Deutsch</option><option value="en">English</option></select>
          <span data-i18n="secView"></span>
          <select class="twl-view"><option value="list" data-i18n="viewList"></option><option value="tiles" data-i18n="viewTiles"></option></select>
        </div>
        <div class="twl-settings twl-s-ver">
          <span class="twl-version"></span>
          <button data-act="update-check" data-i18n="checkUpdates" data-i18n-title="checkUpdatesTitle"></button>
          <span class="twl-upd-status"></span>
        </div>
        <div class="twl-settings twl-s-old">
          <button data-act="key" data-i18n="apiKey" data-i18n-title="apiKeyTitle"></button>
          <span class="twl-key-status"></span>
        </div>
        <div class="twl-settings twl-s-old">
          <span data-i18n="updateEvery"></span>
          <input type="number" class="twl-interval" min="${MIN_REFRESH_S}" max="${MAX_REFRESH_S}" step="5" /> s
          <span class="twl-rate"></span>
        </div>
        <div class="twl-settings twl-s-old">
          <label><input type="checkbox" class="twl-ff-toggle" /> 📊 FF Scouter</label>
          <button data-act="ff-key" data-i18n="ffKey" data-i18n-title="ffKeyTitle"></button>
          <button data-act="ff-reload" class="twl-ff-reload" data-i18n="ffReload" data-i18n-title="ffReloadTitle"></button>
          <span class="twl-ff-status"></span>
        </div>
        <div class="twl-settings twl-s-old">
          <label><input type="checkbox" class="twl-hits-toggle" /> 🎯 Today's Hits</label>
          <label><input type="checkbox" class="twl-chain-toggle" /> <span data-i18n="chainToggle"></span></label>
          <label><input type="checkbox" class="twl-nyan-toggle" /> 🌈 Nyan Cat</label>
        </div>
        <div class="twl-settings twl-s-old">
          <label data-i18n-title="soundTitle"><input type="checkbox" class="twl-sound-toggle" /> <span data-i18n="sound"></span></label>
          <input type="range" class="twl-sound-vol" min="0" max="100" step="5" data-i18n-title="volume" />
          <button data-act="sound-test" data-i18n-title="soundTestTitle">▶ Test</button>
        </div>
        <div class="twl-settings twl-s-old">
          <button data-act="export" data-i18n-title="exportTitle">⬇ Export</button>
          <button data-act="import" data-i18n-title="importTitle">⬆ Import</button>
          <input type="file" accept=".json,application/json" class="twl-import-input" hidden />
        </div>
        <div class="twl-sec" data-i18n="secHelp"></div>
        <details class="twl-legend">
          <summary data-i18n="legend"></summary>
          <div class="twl-legend-body"></div>
        </details>
      </div>
      <div class="twl-foot"><span class="twl-foot-text"></span><span class="twl-foot-rate"></span></div>
    </div>
    <div class="twl-resize" data-corner="tl" data-i18n-title="resize"></div>
    <div class="twl-resize" data-corner="tr" data-i18n-title="resize"></div>
    <div class="twl-resize" data-corner="bl" data-i18n-title="resize"></div>
    <div class="twl-resize" data-corner="br" data-i18n-title="resize"></div>`;
  document.body.appendChild(panel);

  const $ = (sel) => panel.querySelector(sel);
  // Touch screen (iPhone, iPad, Android): bigger handles, "P" square instead of a collapsed panel
  const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches;
  panel.classList.toggle('twl-touch', IS_TOUCH); // touch layout of the header buttons
  // Header mode (touch only): a "P" button right after the ☰ menu in Torn's header, and the panel
  // sits inline below the header instead of floating. Without a spot in the header, the floating
  // "P" square stays in use.
  const headerBtn = document.createElement('button');
  headerBtn.type = 'button';
  headerBtn.className = 'twl-hbtn';
  headerBtn.textContent = 'P'; // no title: on iOS its tooltip sticks after a tap
  // Chain timer badge right next to the P (only while a chain runs); the P stays visible
  const headerTimer = document.createElement('span');
  headerTimer.className = 'twl-htimer';
  let headerMode = false;
  // Torn draws its header a moment after the page loads (and redraws it now and then). Until we
  // had a fair chance to find it, the floating fallback stays hidden – otherwise the old floating
  // "P" flashes up on every page load before it jumps into the header.
  const HEADER_WAIT_LOAD_MS = 4000;
  const HEADER_WAIT_REDRAW_MS = 2000;
  let headerWaitUntil = IS_TOUCH ? Date.now() + HEADER_WAIT_LOAD_MS : 0;
  let headerWaitTimer = 0;
  const input = $('.twl-add input');

  // Position: either docked to the right/left edge ("side") or moved freely ("pos").
  // When moved freely the panel is anchored top left, so resizing grows it to the right.
  function clampPos(x, y) {
    const r = panel.getBoundingClientRect();
    return {
      x: Math.round(Math.min(Math.max(0, x), Math.max(0, window.innerWidth - r.width))),
      y: Math.round(Math.min(Math.max(0, y), Math.max(0, window.innerHeight - 30))),
    };
  }

  // Inline panel: remember where it starts on the page, the CSS height subtracts that
  let headerObserved = false;
  function fitInline() {
    if (!panel.classList.contains('twl-inline') || panel.classList.contains('twl-collapsed')) return;
    const marginTop = 6;
    const top = Math.max(0, Math.round(panel.getBoundingClientRect().top + window.scrollY - marginTop));
    panel.style.setProperty('--twl-top', `${top + marginTop}px`);
  }

  function applyLayout() {
    // Header mode: the panel lives in the page right below Torn's header, in full screen height
    panel.classList.toggle('twl-inline', headerMode);
    if (headerMode) {
      panel.classList.remove('twl-wait');
      const collapsed = GM_getValue('collapsed', false);
      const root = document.getElementById('header-root');
      if (root && root.nextElementSibling !== panel) root.after(panel);
      panel.classList.toggle('twl-collapsed', collapsed);
      panel.classList.remove('twl-mini-mode', 'twl-right', 'twl-left');
      panel.classList.add('twl-sized'); // flex layout, the list scrolls inside
      panel.style.left = panel.style.top = panel.style.right = panel.style.width = panel.style.height = '';
      headerBtn.classList.toggle('twl-hbtn-open', !collapsed);
      fitInline();
      if (root && !headerObserved && window.ResizeObserver) {
        headerObserved = true;
        new ResizeObserver(fitInline).observe(root); // e.g. the news ticker loads later
      }
      return;
    }
    if (panel.parentElement !== document.body) document.body.appendChild(panel);
    const waiting = IS_TOUCH && Date.now() < headerWaitUntil;
    panel.classList.toggle('twl-wait', waiting);
    clearTimeout(headerWaitTimer);
    if (waiting) headerWaitTimer = setTimeout(applyLayout, headerWaitUntil - Date.now() + 50); // still no header → fallback
    const pos = GM_getValue('pos', null);
    const side = pos ? 'left' : GM_getValue('side', 'right');
    panel.classList.toggle('twl-right', side === 'right');
    panel.classList.toggle('twl-left', side === 'left');
    const collapsed = GM_getValue('collapsed', false);
    panel.classList.toggle('twl-collapsed', collapsed);
    panel.classList.toggle('twl-mini-mode', collapsed && IS_TOUCH);
    // Saved size, but never bigger than the screen (e.g. a size imported from a PC onto a phone).
    // Only the display is limited – the saved value stays as it is.
    const size = GM_getValue('size', null);
    const maxW = Math.max(MIN_W, window.innerWidth - 8);
    const maxH = Math.max(MIN_H, window.innerHeight - 8);
    panel.style.width = size ? `${Math.min(size.w, maxW)}px` : '';
    panel.style.height = size && !collapsed ? `${Math.min(size.h, maxH)}px` : '';
    panel.classList.toggle('twl-sized', !!size && !collapsed);
    // Only display the saved position, don't overwrite it – push it on screen in a smaller window
    const p = pos ? clampPos(pos.x, pos.y) : null;
    panel.style.left = p ? `${p.x}px` : '';
    panel.style.top = p ? `${p.y}px` : '';
    panel.style.right = p ? 'auto' : '';
    // Still sticking out at the bottom? Then shorten it so the bottom corners stay reachable
    if (size && !collapsed) {
      const r = panel.getBoundingClientRect();
      if (r.bottom > window.innerHeight - 4) {
        panel.style.height = `${Math.max(MIN_H, Math.floor(window.innerHeight - 4 - r.top))}px`;
      }
    }
  }
  window.addEventListener('resize', applyLayout);

  // Moving: drag the header (not the buttons). Double-click docks it to the edge again.
  const head = $('.twl-head');
  head.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || ev.target.closest('button') || headerMode) return; // inline panel stays put
    ev.preventDefault();
    head.setPointerCapture(ev.pointerId);
    const rect = panel.getBoundingClientRect();
    const start = { x: ev.clientX, y: ev.clientY, left: rect.left, top: rect.top };
    let pos = null;
    const move = (e) => {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!pos && Math.abs(dx) + Math.abs(dy) < 4) return; // a small wobble is not a drag
      pos = clampPos(start.left + dx, start.top + dy);
      panel.style.left = `${pos.x}px`;
      panel.style.top = `${pos.y}px`;
      panel.style.right = 'auto';
      panel.classList.remove('twl-right');
      panel.classList.add('twl-left');
    };
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      head.removeEventListener('pointercancel', up);
      if (pos) GM_setValue('pos', pos);
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  });
  head.addEventListener('dblclick', (ev) => {
    if (ev.target.closest('button') || headerMode) return;
    GM_setValue('pos', null);
    applyLayout();
  });

  // The "P" square of a collapsed panel on touch screens: a tap opens the panel again,
  // dragging moves the square (and with it the panel).
  const mini = $('.twl-mini');
  mini.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    mini.setPointerCapture(ev.pointerId);
    const rect = panel.getBoundingClientRect();
    const start = { x: ev.clientX, y: ev.clientY, left: rect.left, top: rect.top };
    let pos = null;
    const move = (e) => {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!pos && Math.abs(dx) + Math.abs(dy) < 8) return; // a finger tap wobbles a bit
      pos = clampPos(start.left + dx, start.top + dy);
      panel.style.left = `${pos.x}px`;
      panel.style.top = `${pos.y}px`;
      panel.style.right = 'auto';
    };
    const up = (e) => {
      mini.removeEventListener('pointermove', move);
      mini.removeEventListener('pointerup', up);
      mini.removeEventListener('pointercancel', up);
      if (pos) {
        GM_setValue('pos', pos);
      } else if (e.type === 'pointerup') {
        GM_setValue('collapsed', false);
        applyLayout();
      }
    };
    mini.addEventListener('pointermove', move);
    mini.addEventListener('pointerup', up);
    mini.addEventListener('pointercancel', up);
  });

  // Header mode: find Torn's ☰ menu in the mobile header and put our button right after it.
  // Torn's ☰ is button#fly-out-menu-button ("Show sidebar"). Careful: the ⓘ info button and the
  // avatar are also labelled "Open menu", so a plain "menu" match would hit the wrong button.
  const HEADER_SPOT_SELECTORS = [
    '#fly-out-menu-button', 'button[aria-controls="fly-out-panel"]', '[class*="menuButton" i]',
    'button[aria-label*="sidebar" i]', '[class*="hamburger" i]', '[class*="burger" i]',
  ];
  let headerSpot = null;
  function findHeaderSpot() {
    const root = document.getElementById('header-root');
    if (!root) return null;
    const visible = (el) => el.getClientRects().length > 0 && !panel.contains(el);
    for (const sel of HEADER_SPOT_SELECTORS) {
      const el = [...root.querySelectorAll(sel)].find(visible);
      // An icon inside the menu button? Then go after the button itself, not inside it
      if (el) return el.closest('button, a, [role="button"]') || el;
    }
    return null;
  }
  // Torn moves the ☰ next to the logo with CSS, so its place in the HTML says little about where
  // it shows up. Our button is positioned by the ☰'s real spot: right next to it, centred.
  function placeHeaderBtn() {
    if (!headerSpot || !headerSpot.isConnected || !headerBtn.isConnected) return;
    const left = `${headerSpot.offsetLeft + headerSpot.offsetWidth + 6}px`;
    const top = `${headerSpot.offsetTop + Math.round((headerSpot.offsetHeight - headerBtn.offsetHeight) / 2)}px`;
    if (headerBtn.style.left !== left) headerBtn.style.left = left;
    if (headerBtn.style.top !== top) headerBtn.style.top = top;
    // Timer badge right next to the P
    const tLeft = `${headerBtn.offsetLeft + headerBtn.offsetWidth + 4}px`;
    if (headerTimer.style.left !== tLeft) headerTimer.style.left = tLeft;
    if (headerTimer.style.top !== top) headerTimer.style.top = top;
    // Not enough room before Torn's icons on the right for "⛓ 01:12"? Then a compact "01:12"
    const nav = document.querySelector('#header-root .header-navigation');
    if (nav) {
      const room = nav.getBoundingClientRect().left - headerBtn.getBoundingClientRect().right - 8; // works while hidden too
      headerTimer.classList.toggle('twl-compact', room < 76);
    }
  }
  function syncHeaderMode() {
    if (!IS_TOUCH) return;
    if (!headerBtn.isConnected || !headerTimer.isConnected || !headerSpot || !headerSpot.isConnected) {
      headerSpot = findHeaderSpot();
      if (headerSpot) headerSpot.after(headerBtn, headerTimer); // Torn redraws its header now and then – put it back
    }
    placeHeaderBtn();
    if (headerBtn.isConnected !== headerMode) {
      headerMode = headerBtn.isConnected;
      if (!headerMode) headerWaitUntil = Date.now() + HEADER_WAIT_REDRAW_MS; // header just redrawn: wait a bit
      applyLayout();
    }
  }
  window.addEventListener('resize', placeHeaderBtn);
  // The P toggles the panel. It reacts to the finger lifting (pointerup) instead of "click":
  // Torn's header handles touches itself, and on iOS that can swallow the click entirely.
  // Touches on the P never reach Torn's handlers. "click" stays as a fallback (keyboard etc.).
  let headerToggleAt = 0;
  function toggleFromHeader() {
    if (Date.now() - headerToggleAt < 500) return; // pointerup and click from the same tap
    headerToggleAt = Date.now();
    const open = GM_getValue('collapsed', false);
    GM_setValue('collapsed', !open);
    applyLayout();
    if (open) window.scrollTo({ top: 0, behavior: 'smooth' }); // header + panel in view, even when scrolled down
  }
  for (const type of ['pointerdown', 'touchstart', 'touchend', 'mousedown']) {
    headerBtn.addEventListener(type, (ev) => ev.stopPropagation(), { passive: true });
  }
  headerBtn.addEventListener('pointerup', (ev) => {
    ev.stopPropagation();
    if (ev.isPrimary !== false && ev.button <= 0) toggleFromHeader();
  });
  headerBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    toggleFromHeader();
  });

  // Resize from any of the four corners (mouse and touch). The opposite corner stays put.
  // A docked panel stays docked as long as its docked edge and its top don't move.
  const MIN_W = 180;
  const MIN_H = 120;
  for (const handle of panel.querySelectorAll('.twl-resize')) {
    const corner = handle.dataset.corner;
    const fromLeft = corner.includes('l');
    const fromTop = corner.includes('t');
    handle.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      handle.setPointerCapture(ev.pointerId);
      const r = panel.getBoundingClientRect();
      const start = { x: ev.clientX, y: ev.clientY, l: r.left, t: r.top, rt: r.right, b: r.bottom };
      let box = null;
      const move = (e) => {
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        let { l, t, rt, b } = start;
        if (fromLeft) l = Math.min(Math.max(0, l + dx), rt - MIN_W);
        else rt = Math.max(Math.min(window.innerWidth, rt + dx), l + MIN_W);
        if (fromTop) t = Math.min(Math.max(0, t + dy), b - MIN_H);
        else b = Math.max(Math.min(window.innerHeight, b + dy), t + MIN_H);
        box = { x: Math.round(l), y: Math.round(t), w: Math.round(rt - l), h: Math.round(b - t) };
        panel.style.left = `${box.x}px`;
        panel.style.top = `${box.y}px`;
        panel.style.right = 'auto';
        panel.style.width = `${box.w}px`;
        panel.style.height = `${box.h}px`;
        panel.classList.add('twl-sized');
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        if (!box) return;
        const docked = !GM_getValue('pos', null);
        const side = GM_getValue('side', 'right');
        const keepsDock = docked && !fromTop && (side === 'right' ? fromLeft : !fromLeft);
        GM_setValue('size', { w: box.w, h: box.h });
        if (!keepsDock) GM_setValue('pos', { x: box.x, y: box.y });
        applyLayout();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    handle.addEventListener('dblclick', () => {
      GM_setValue('size', null);
      applyLayout();
    });
  }

  // Soft fold/unfold: closing slides the open part shut first and then switches the state;
  // opening switches the state first and then slides the new part open. Skipped for
  // "reduce motion" and while the same part is still moving.
  const FOLD_MS = 220;
  const folding = new Set();
  // Full size of a part, as border-box keyframe (height incl. padding, so boxes with padding don't jump)
  const foldFrame = (el) => {
    const cs = getComputedStyle(el);
    return { height: `${el.offsetHeight}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, opacity: 1 };
  };
  const FOLD_SHUT = { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 };
  function animateFold(key, getEl, opening, apply) {
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches || !Element.prototype.animate;
    if (folding.has(key)) return;
    if (calm) { apply(); return; }
    if (!opening) {
      const el = getEl();
      if (!el || !el.offsetHeight) { apply(); return; }
      folding.add(key);
      el.style.overflow = 'hidden';
      el.style.boxSizing = 'border-box';
      el.animate([foldFrame(el), FOLD_SHUT],
        { duration: FOLD_MS, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' })
        .finished.catch(() => {}).then(() => { folding.delete(key); apply(); });
      return;
    }
    apply();
    const el = getEl();
    if (!el || !el.offsetHeight) return;
    folding.add(key);
    const full = foldFrame(el);
    el.style.overflow = 'hidden';
    el.style.boxSizing = 'border-box';
    el.animate([FOLD_SHUT, full], { duration: FOLD_MS, easing: 'cubic-bezier(.4, 0, .2, 1)' })
      .finished.catch(() => {}).then(() => { folding.delete(key); el.style.overflow = ''; el.style.boxSizing = ''; });
  }

  function setHtml(el, html) {
    if (el.dataset.html === html) return;
    el.dataset.html = html;
    el.innerHTML = html;
  }

  // FF display of a row: number colored from blue (easy, FF 1) to red (difficult, FF 5+)
  function ffInfo(d, now) {
    if (!d) return { text: '…', cls: 'twl-ff-none', title: t('ffLoading') };
    const ff = Number(d.ff);
    if (d.ff == null || !Number.isFinite(ff)) return { text: '–', cls: 'twl-ff-none', title: t('ffNoData') };
    const old = d.upd && now - d.upd > FF_OLD_S;
    const frac = (Math.min(Math.max(ff, 1), 5) - 1) / 4;
    const label = t('ffLevels')[ff <= 1 ? 0 : ff <= 2 ? 1 : ff <= 3.5 ? 2 : ff <= 4.5 ? 3 : 4];
    return {
      text: `${ff.toFixed(2)}${old ? '?' : ''}`,
      cls: '',
      color: `hsl(${Math.round(220 - frac * 220)}, 90%, 65%)`,
      title: `Fair Fight ${ff.toFixed(2)} (${label})`
        + (d.bs ? `\n${t('ffStats', d.bs)}` : '')
        + (d.upd ? `\n${t('ffAge', formatAge(Math.max(0, now - d.upd)), old)}` : ''),
    };
  }

  function render() {
    const list = getList();
    const factions = getFactions();
    const now = Math.floor(Date.now() / 1000);

    // Shown players: members of watched factions (without hidden ones) + single players
    const shown = new Map();
    for (const f of factions) {
      const hidden = new Set(f.hidden);
      for (const m of f.members) {
        if (!hidden.has(m.id)) shown.set(m.id, { ...m, error: null, faction: { id: f.id, name: f.name, tag: f.tag } });
      }
    }
    for (const e of list) if (!shown.has(e.id)) shown.set(e.id, e);
    $('.twl-count').textContent = `(${shown.size})`;

    // Buttons for the currently open player or faction profile
    const profileParts = [];
    const pid = currentProfileId();
    if (pid != null) {
      profileParts.push(shown.has(pid)
        ? `<button data-act="remove" data-id="${pid}">${t('onListRemove')}</button>`
        : `<button data-act="add-profile" data-id="${pid}">${t('addProfile', pid)}</button>`);
      const fac = knownFactionOf(pid, factions);
      if (fac && fac.id && factions.some((f) => f.id === fac.id)) {
        profileParts.push(`<button disabled>${t('factionOnList', esc(fac.name || fac.id))}</button>`);
      } else if (!fac || fac.id) {
        profileParts.push(`<button data-act="add-player-faction" data-id="${pid}">${t('addPlayerFaction', fac ? esc(fac.name) : '')}</button>`);
      }
    }
    const fpid = currentFactionPageId();
    if (fpid != null) {
      profileParts.push(factions.some((f) => f.id === fpid)
        ? `<button data-act="remove-faction" data-fid="${fpid}">${t('factionPageOnList')}</button>`
        : `<button data-act="add-faction" data-fid="${fpid}">${t('addThisFaction', fpid)}</button>`);
    }
    setHtml($('.twl-profile'), profileParts.join(''));

    // List: players not in hospital first (longest inactive on top), then by hospital time
    // left – whoever gets out next is higher up.
    const rows = [...shown.values()]
      .map((e) => ({ ...e, age: e.ts ? Math.max(0, now - e.ts) : null, hosp: hospitalLeft(e.status, now) }))
      .sort((a, b) => a.hosp - b.hosp || (b.age ?? -1) - (a.age ?? -1));

    // Group by faction (order within a group stays as sorted above).
    // Watched factions (★) first, then the rest alphabetically, "No faction"/"Not loaded yet" at the end.
    const groups = new Map();
    for (const f of factions) {
      groups.set(f.id, { id: f.id, name: f.name || `Faction ${f.id}`, tag: f.tag, watched: f, rows: [] });
    }
    for (const e of rows) {
      const f = e.faction || { id: 'unknown', name: t('notLoaded'), tag: '' };
      // "No faction" is stored from the API response – show it in the current language
      if (!groups.has(f.id)) groups.set(f.id, { ...f, name: f.id === 0 ? t('noFaction') : f.name, watched: null, rows: [] });
      groups.get(f.id).rows.push(e);
    }
    const rank = (g) => (g.watched ? 0 : g.id === 'unknown' ? 3 : g.id === 0 ? 2 : 1);
    const sortedGroups = [...groups.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    const collapsedGroups = GM_getValue('collapsedGroups', {});

    const rowHtml = (e) => `
      <div class="twl-row" data-id="${e.id}">
        <div class="twl-who">
          <a href="/profiles.php?XID=${e.id}">${esc(e.name || '…')}</a> <span class="twl-id">[${e.id}]</span>
          ${e.error ? `<div class="twl-err">${esc(e.error)}</div>` : ''}
        </div>
        <span class="twl-age"></span>
        <span class="twl-ff"></span>
        <span class="twl-seen"></span>
        <button class="twl-x" data-act="remove" data-id="${e.id}" title="${t('remove')}">✕</button>
      </div>`;
    // Extra lines of a watched faction: error / no data yet / restore button
    const factionExtras = (f) => {
      const memberIds = new Set(f.members.map((m) => m.id));
      const hiddenCount = f.hidden.filter((h) => memberIds.has(h)).length;
      let html = '';
      if (f.error) html += `<div class="twl-err twl-gnote">${esc(f.error)}</div>`;
      else if (!f.members.length) html += `<div class="twl-gnote">${t('noDataYet')}</div>`;
      if (hiddenCount) {
        html += `<button class="twl-restore" data-act="restore" data-fid="${f.id}">${t('restoreAll', hiddenCount)}</button>`;
      }
      return html;
    };
    const groupHtml = (g) => {
      const closed = !!collapsedGroups[g.id];
      return `
        <div class="twl-group" data-gid="${g.id}">
          <div class="twl-ghead">
            <button class="twl-gtoggle" data-act="group" data-gid="${g.id}" title="${t('collapse')}">
              <span class="twl-caret">${closed ? '▸' : '▾'}</span>
              ${g.watched ? `<span class="twl-star" title="${t('watchedFaction')}">★</span>` : ''}
              <span class="twl-gname">${esc(g.name)}${g.tag ? ` <span class="twl-gtag">[${esc(g.tag)}]</span>` : ''}</span>
              <span class="twl-gcount">${g.rows.length}</span>
              <span class="twl-badges"></span>
            </button>
            ${g.watched ? `<button class="twl-gx" data-act="remove-faction" data-fid="${g.id}" title="${t('removeFaction')}">✕</button>` : ''}
          </div>
          ${closed ? '' : `<div class="twl-grows">${g.rows.map(rowHtml).join('')}${g.watched ? factionExtras(g.watched) : ''}</div>`}
        </div>`;
    };

    // Only rebuild the structure when something changed; otherwise just update time + color,
    // so clicks are not lost to the redraw every second.
    setHtml($('.twl-list'), sortedGroups.length
      ? sortedGroups.map(groupHtml).join('')
      : `<div class="twl-empty">${t('emptyList')}</div>`);
    const ffOn = ffEnabled();
    const ffCache = ffOn ? getFfCache() : {};
    const tilesView = getView() === 'tiles';
    $('.twl-list').classList.toggle('twl-view-tiles', tilesView);
    for (const e of rows) {
      const row = $(`.twl-row[data-id="${e.id}"]`);
      if (!row) continue; // group collapsed
      // Color still by last action, the status (hospital countdown) is displayed
      row.className = `twl-row ${colorClass(e.age)}${e.hosp ? ' twl-hosp' : ''}`;
      row.querySelector('.twl-age').textContent = statusLabel(e.status, now);
      row.title = e.age == null ? '' : t('lastAction', formatAge(e.age));
      // Tile view shows the last action right on the tile (no tooltips on phones)
      if (tilesView) row.querySelector('.twl-seen').textContent = seenLabel(e.age);
      const ffEl = row.querySelector('.twl-ff');
      ffEl.style.display = ffOn ? '' : 'none';
      if (ffOn) {
        const f = ffInfo(ffCache[e.id], now);
        ffEl.textContent = f.text;
        ffEl.className = `twl-ff ${f.cls}`;
        ffEl.style.color = f.color || '';
        ffEl.title = f.title;
      }
    }
    // Color counters in the group head, so you see who has been away how long even when collapsed
    for (const g of sortedGroups) {
      const counts = {};
      for (const e of g.rows) counts[colorClass(e.age)] = (counts[colorClass(e.age)] || 0) + 1;
      const badges = ['twl-green', 'twl-orange', 'twl-red', 'twl-unknown']
        .filter((c) => counts[c])
        .map((c) => `<span class="twl-b ${c}">${counts[c]}</span>`)
        .join('');
      setHtml($(`.twl-group[data-gid="${g.id}"] .twl-badges`), badges);
    }

    // Estimated API usage of the watchlist (limit: 100/min per account, all keys combined):
    // one call per faction + one per single player not already covered by a faction
    const covered = coveredIds(factions);
    const hits = getHits();
    const hitsCall = hitsEnabled() && !(hits.denied && GM_getValue('hitsDeniedKey', '') === getKey()) ? 1 : 0;
    const calls = factions.length + list.filter((e) => !covered.has(e.id)).length + hitsCall;
    // plus the chain timer on touch screens: every 6 s while a chain runs
    const chainPerMin = useApiChain() && apiChainRunning() ? Math.round(60000 / CHAIN_POLL_RUNNING_MS) : 0;
    const honPerMin = honorsVisible() && getKey() && !isPaused() ? 3 * 60000 / HON_REFRESH_MS : 0;
    const perMin = Math.round(calls * 60 / getRefreshS() + honPerMin) + chainPerMin;
    const rate = $('.twl-rate');
    rate.textContent = t('perMin', perMin);
    rate.title = t('callsPerUpdate', calls);
    rate.classList.toggle('twl-warn', perMin > 60);

    // Today's hits strip (visible even when the panel is collapsed)
    const hitsBtn = $('.twl-hits');
    hitsBtn.style.display = hitsEnabled() ? '' : 'none';
    setHtml(hitsBtn, `${t('hitsStrip', hits.hits)}${hitsLoading ? ' …' : ''}`
      + (hits.error ? ` <span class="twl-hits-err">(${esc(hits.error)})</span>` : ''));
    hitsBtn.title = t('hitsTitle', hits.attempts, hits.hits, hits.warHits);

    // FF Scouter status: error or which key is used
    const ffStatus = $('.twl-ff-status');
    const ffErr = GM_getValue('ffError', '');
    ffStatus.className = `twl-ff-status${ffErr ? ' twl-ff-err' : ''}`;
    ffStatus.textContent = !ffOn ? '' : ffErr || (GM_getValue('ffKey', '') ? t('ffOwnKey') : getKey() ? t('ffWatchlistKey') : t('ffNoKey'));
    ffStatus.title = ffErr ? `FF Scouter: ${ffErr}` : '';
    const ffReload = $('.twl-ff-reload');
    ffReload.style.display = ffOn ? '' : 'none';
    ffReload.disabled = ffLoading || !getFfKey();

    const keyStatus = $('.twl-key-status');
    keyStatus.textContent = getKey() ? t('apiKeySet') : t('apiKeyMissing');
    keyStatus.classList.toggle('twl-ff-err', !getKey());
    syncGrid();

    const paused = isPaused();
    const pauseBtn = $('.twl-pause');
    pauseBtn.textContent = paused ? '▶' : '⏸';
    pauseBtn.title = paused ? t('resume') : t('pause');
    pauseBtn.classList.toggle('twl-off', paused);

    const foot = $('.twl-foot');
    const footText = $('.twl-foot-text');
    foot.classList.toggle('twl-off', paused && !refreshing);
    if (paused && !refreshing) {
      footText.textContent = t('footPaused');
    } else if (!getKey()) {
      footText.textContent = t('footNoKey');
    } else if (refreshing) {
      footText.textContent = t('footUpdating');
    } else {
      const last = GM_getValue('lastRefresh', 0);
      footText.textContent = last ? t('footLast', formatAge(Math.floor((Date.now() - last) / 1000))) : '';
    }
    // Requests per minute bottom right – only when requests actually run
    const footRate = $('.twl-foot-rate');
    footRate.textContent = paused || !getKey() ? '' : rate.textContent;
    footRate.title = rate.title;
    footRate.classList.toggle('twl-warn', perMin > 60);
  }

  panel.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const id = parseInt(btn.dataset.id, 10);
    const fid = parseInt(btn.dataset.fid, 10);
    switch (btn.dataset.act) {
      case 'add-profile': addPlayer(id); break;
      case 'remove': removePlayer(id); break;
      case 'add-player-faction': addFactionOfPlayer(id, btn); break;
      case 'add-faction': addFaction(fid); break;
      case 'remove-faction': removeFaction(fid); break;
      case 'restore': restoreFaction(fid); break;
      case 'add-input': addFromInput(addPlayer); break;
      case 'add-input-faction': addFromInput(addFaction); break;
      case 'refresh':
        if (getTab() === 'honors' && $('.twl-spage').hidden) refreshHonors(true);
        else refreshAll(true);
        break;
      case 'sound-test': testBomb(); break;
      case 'export': exportSettings(); break;
      case 'ff-key': {
        const k = prompt(t('ffKeyPrompt'), GM_getValue('ffKey', ''));
        if (k === null) break;
        GM_setValue('ffKey', k.trim());
        GM_setValue('ffCache', {}); // FF depends on the key owner -> refetch everything
        GM_setValue('ffError', '');
        if (ffEnabled()) refreshFF(shownIds()).then(render);
        render();
        break;
      }
      case 'ff-reload': {
        // e.g. after the gym: FF depends on your own stats, so skip the 30-minute cache
        if (ffLoading) break;
        GM_setValue('ffCache', {});
        GM_setValue('ffError', '');
        const done = refreshFF(shownIds()).then(render);
        render();
        done.catch(() => {});
        break;
      }
      case 'import': $('.twl-import-input').click(); break;
      case 'hits': {
        const key = getKey();
        if (!key) break;
        GM_setValue('hitsDeniedKey', ''); // deliberate click: retry even after an access error
        const done = refreshHits(key).then(render);
        render();
        done.catch(() => {});
        break;
      }
      case 'group': {
        const gid = btn.dataset.gid;
        const opening = !!GM_getValue('collapsedGroups', {})[gid];
        const caret = btn.querySelector('.twl-caret');
        if (caret) caret.textContent = opening ? '▾' : '▸';
        animateFold(`g${gid}`, () => panel.querySelector(`.twl-group[data-gid="${CSS.escape(gid)}"] .twl-grows`), opening, () => {
          const groups = GM_getValue('collapsedGroups', {});
          if (opening) delete groups[gid];
          else groups[gid] = true;
          GM_setValue('collapsedGroups', groups);
          render();
        });
        break;
      }
      case 'pause':
        GM_setValue('paused', !isPaused());
        // Refresh right away when resuming instead of waiting for the next interval.
        if (!isPaused()) refreshAll(true);
        render();
        break;
      case 'side':
        // Moved freely? Then first dock back to the previous edge.
        if (GM_getValue('pos', null)) GM_setValue('pos', null);
        else GM_setValue('side', GM_getValue('side', 'right') === 'right' ? 'left' : 'right');
        applyLayout();
        break;
      case 'collapse':
        GM_setValue('collapsed', !GM_getValue('collapsed', false));
        applyLayout();
        break;
      case 'key': {
        const k = prompt(t('apiKeyPrompt'), getKey());
        if (k !== null) {
          GM_setValue('apiKey', k.trim());
          refreshAll(true);
          render();
        }
        break;
      }
      case 'settings':
        showSettings($('.twl-spage').hidden);
        break;
      case 'update-check':
        checkForUpdate();
        break;
      // Touch settings grid: the tiles drive the (hidden) desktop controls, so all logic stays in one place
      case 'tile': {
        const cb = $(btn.dataset.for);
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
        syncGrid();
        break;
      }
      case 'seg-lang':
        langSelect.value = btn.dataset.v;
        langSelect.dispatchEvent(new Event('change'));
        break;
      case 'seg-interval':
        intervalInput.value = btn.dataset.v;
        intervalInput.dispatchEvent(new Event('change'));
        break;
      case 'seg-view':
        setView(btn.dataset.v);
        break;
      // Honor tracker
      case 'tab': setTab(btn.dataset.v); break;
      case 'hon-mode':
        GM_setValue('honMode', btn.dataset.v);
        hon.tier = 0;
        renderHonors();
        $('.twl-hon-list').scrollTop = 0;
        break;
      case 'hon-fold': {
        const d = parseInt(btn.dataset.v, 10);
        const opening = GM_getValue('honClosedTiers', []).includes(d);
        const caret = btn.querySelector('.twl-caret');
        if (caret) caret.textContent = opening ? '▾' : '▸';
        animateFold(`t${d}`, () => $(`.twl-hon-group[data-tier="${d}"]`), opening, () => {
          const closed = GM_getValue('honClosedTiers', []);
          GM_setValue('honClosedTiers', opening ? closed.filter((x) => x !== d) : [...closed, d]);
          renderHonors();
        });
        break;
      }
      case 'hon-tier': {
        const d = parseInt(btn.dataset.v, 10);
        hon.tier = hon.tier === d ? 0 : d;
        renderHonors();
        break;
      }
      case 'hon-cat': hon.cat = parseInt(btn.dataset.v, 10); renderHonors(); $('.twl-hon-list').scrollTop = 0; break;
      case 'hon-guide': {
        const opening = !hon.open.has(id);
        btn.textContent = t(opening ? 'honGuideClose' : 'honGuide');
        animateFold(`h${id}`, () => $(`.twl-hc-guide[data-id="${id}"]`), opening, () => {
          if (opening) hon.open.add(id);
          else hon.open.delete(id);
          renderHonors();
        });
        break;
      }
      case 'hon-done': toggleIn('honorsDone', id); break;
      case 'hon-hide': toggleIn('honorsHidden', id); break;
      case 'hon-sync': refreshHonors(true); break;
      case 'hon-earned': hon.showEarned = !hon.showEarned; renderHonors(); break;
      case 'hon-hidden': hon.showHidden = !hon.showHidden; renderHonors(); break;
      // Action menu of a tile (long press)
      case 'menu-attack':
        hidePlayerMenu();
        location.href = `https://www.torn.com/loader.php?sid=attack&user2ID=${id}`;
        break;
      case 'menu-profile':
        hidePlayerMenu();
        location.href = `https://www.torn.com/profiles.php?XID=${id}`;
        break;
      case 'menu-copy':
        copyPlayer(btn.dataset.name, id)
          .then(() => { btn.textContent = `✓ ${t('warCopied')}`; })
          .catch(() => { btn.textContent = t('warCopyFailed'); })
          .finally(() => setTimeout(hidePlayerMenu, 700));
        break;
      case 'menu-remove':
        hidePlayerMenu();
        removePlayer(id);
        break;
    }
  });

  // Compare the installed version with the one on GitHub. Opening the .user.js link only works
  // as an update on desktop – Safari on iOS just shows the source – so the check runs here.
  const newerVersion = (a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    }
    return false;
  };
  // GitHub's raw CDN caches the file for ~5 minutes and ignores query strings, so right after a
  // release "…/main/…" can still be the old version. Asking the GitHub API for the newest commit
  // and loading the file pinned to that commit always gives the current one (install link too).
  const GH_RAW = UPDATE_URL.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
  const httpGet = (url, headers = {}) => new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'GET', url, headers, timeout: 15000,
      onload: resolve,
      onerror: () => reject(new Error('network')),
      ontimeout: () => reject(new Error('timeout')),
    });
  });
  async function latestFileUrl() {
    if (!GH_RAW) return UPDATE_URL;
    const [, owner, repo, ref, path] = GH_RAW;
    try {
      const r = await httpGet(`https://api.github.com/repos/${owner}/${repo}/commits/${ref}`,
        { Accept: 'application/vnd.github+json' });
      const sha = r.status === 200 && JSON.parse(r.responseText).sha;
      if (sha) return `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${path}`;
    } catch {
      // API not reachable or rate limit (60/h) – fall back to the normal (maybe cached) address
    }
    return UPDATE_URL;
  }
  async function checkForUpdate() {
    const status = $('.twl-upd-status');
    const fail = () => { status.textContent = t('updFailed'); status.classList.add('twl-ff-err'); };
    status.className = 'twl-upd-status';
    status.textContent = t('updChecking');
    try {
      const fileUrl = await latestFileUrl();
      const r = await httpGet(fileUrl);
      const m = r.status === 200 && r.responseText.match(/@version\s+([\d.]+)/);
      if (!m) return fail();
      if (!newerVersion(m[1], SCRIPT_VERSION)) { status.textContent = t('updLatest'); return; }
      status.innerHTML = `${esc(t('updAvailable', m[1]))} · <a href="${esc(fileUrl)}" target="_blank" `
        + `rel="noopener" title="${esc(t('updInstallTitle'))}">${esc(t('updInstall'))}</a>`;
      status.classList.add('twl-upd-new');
    } catch {
      fail();
    }
  }

  // Show the settings page instead of the list (per tab, not saved).
  // If the panel is collapsed, ⚙ expands it.
  function showSettings(open) {
    $('.twl-spage').hidden = !open;
    applyTab();
    $('.twl-settings-btn').classList.toggle('twl-on', open);
    if (open && GM_getValue('collapsed', false)) {
      GM_setValue('collapsed', false);
      applyLayout();
    }
  }

  // ---- Legend (in the settings): example rows with a made-up player -----------------------
  const LEGEND_FAKE_ID = 1234567; // made-up ID, not a real account
  function renderLegend() {
    const name = t('lgExampleName');
    const now = Math.floor(Date.now() / 1000);
    const row = (cls, status, ff) => {
      const f = ff == null ? null : ffInfo(ff, now);
      return `<div class="twl-row ${cls}">
          <div class="twl-who"><b>${esc(name)}</b> <span class="twl-id">[${LEGEND_FAKE_ID}]</span></div>
          <span class="twl-age">${status}</span>
          ${f ? `<span class="twl-ff ${f.cls}" style="color:${f.color || ''}">${f.text}</span>` : ''}
        </div>`;
    };
    const item = (chip, text, extra = '') => `<span class="twl-lg-chip ${extra}">${chip}</span><span>${esc(text)}</span>`;
    const ff = (v, upd = now) => ffInfo({ ff: v, upd }, now);
    const ffChip = (v, text, upd) => {
      const f = ff(v, upd);
      return `<span class="twl-lg-chip" style="color:${f.color}">${f.text}</span><span>${esc(text)}</span>`;
    };
    setHtml($('.twl-legend-body'), `
      <div class="twl-lg-ex">${esc(t('lgExample'))}</div>
      <div class="twl-lg-h">${esc(t('lgRows'))}</div>
      ${row('twl-green', 'Okay', { ff: 1.2, upd: now })}<div class="twl-lg-note">${esc(t('lgGreen'))}</div>
      ${row('twl-orange', 'Okay', { ff: 2.6, upd: now })}<div class="twl-lg-note">${esc(t('lgOrange'))}</div>
      ${row('twl-red', 'Okay', { ff: 4.1, upd: now })}<div class="twl-lg-note">${esc(t('lgRed'))}</div>
      ${row('twl-unknown', '–', null)}<div class="twl-lg-note">${esc(t('lgGray'))}</div>
      <div class="twl-lg-h">${esc(t('lgStatus'))}</div>
      <div class="twl-lg-grid">
        ${item('Okay', t('lgOkay'))}
        ${item(`🏥 ${formatAge(750)}`, t('lgHosp'))}
        ${item(`⛓ ${formatAge(300)}`, t('lgJail'))}
        ${item(t('traveling'), t('lgTravel'))}
        ${item(t('abroad'), t('lgAbroad'))}
      </div>
      <div class="twl-lg-h">${esc(t('lgFF'))}</div>
      <div class="twl-lg-grid">
        ${ffChip(1.2, t('lgFFEasy'))}
        ${ffChip(3, t('lgFFMid'))}
        ${ffChip(6.4, t('lgFFHard'))}
        ${ffChip(2.1, t('lgFFOld'), now - 20 * 86400)}
        ${item('–', t('lgFFNone'))}
        ${item('…', t('lgFFLoading'))}
      </div>
      <div class="twl-lg-h">${esc(t('lgOther'))}</div>
      <div class="twl-lg-grid">
        ${item('★', t('lgStar'))}
        <span><span class="twl-b twl-green">3</span> <span class="twl-b twl-red">1</span></span><span>${esc(t('lgBadges'))}</span>
        ${item('⛓ 01:12', t('lgChain'), 'twl-lg-alert')}
        ${item('✕', t('lgRemove'))}
        ${item('↺', t('lgRestore'))}
      </div>
      <div class="twl-lg-text">${esc(t('lgSort'))}</div>
      <div class="twl-lg-text">${esc(t('lgHover'))}</div>`);
  }
  // Fixed panel texts (data-i18n = text, data-i18n-title = tooltip) in the chosen language
  function applyLang() {
    for (const el of panel.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of panel.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
    for (const el of panel.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
    if (!IS_TOUCH) for (const el of panel.querySelectorAll('[data-i18n-tip]')) el.title = t(el.dataset.i18nTip);
    langSelect.value = getLang();
    $('.twl-version').textContent = t('version', SCRIPT_VERSION);
    $('[data-act="update-check"]').style.display = UPDATE_URL ? '' : 'none';
    renderLegend();
  }
  const langSelect = $('.twl-lang');
  langSelect.addEventListener('change', () => {
    GM_setValue('lang', langSelect.value);
    applyLang();
    render();
    renderHonors();
    updateChain();
  });
  applyLang();

  const viewSelect = $('.twl-view');
  function setView(v) {
    GM_setValue('view', v === 'tiles' ? 'tiles' : 'list');
    viewSelect.value = getView();
    hidePlayerMenu();
    render();
  }
  viewSelect.value = getView();
  viewSelect.addEventListener('change', () => setView(viewSelect.value));

  // ---- Tile view: tap = profile, long press (or right click) = small action menu -----------
  const LONG_PRESS_MS = 450;
  const pmenu = document.createElement('div');
  pmenu.className = 'twl-pmenu';
  pmenu.hidden = true;
  panel.appendChild(pmenu);
  function hidePlayerMenu() { pmenu.hidden = true; }
  function openPlayerMenu(row, x, y) {
    const id = parseInt(row.dataset.id, 10);
    const link = row.querySelector('.twl-who a');
    const name = link ? link.textContent.trim() : String(id);
    const item = (act, label) => `<button type="button" data-act="${act}" data-id="${id}" data-name="${esc(name)}">${esc(t(label))}</button>`;
    pmenu.innerHTML = `<div class="twl-pm-title">${esc(name)} <span>[${id}]</span></div>`
      + item('menu-attack', 'menuAttack') + item('menu-profile', 'menuProfile')
      + item('menu-copy', 'menuCopy') + item('menu-remove', 'menuRemove');
    pmenu.hidden = false;
    // Next to the finger, but always fully inside the panel
    const pr = panel.getBoundingClientRect();
    const w = pmenu.offsetWidth;
    const h = pmenu.offsetHeight;
    pmenu.style.left = `${Math.max(4, Math.min(x - pr.left - w / 2, pr.width - w - 4))}px`;
    pmenu.style.top = `${Math.max(4, Math.min(y - pr.top + 12, pr.height - h - 4))}px`;
  }
  const listEl = $('.twl-list');
  let pressTimer = 0;
  let pressAt = null;
  let pressFired = false;
  let suppressClickUntil = 0;
  const cancelPress = () => { clearTimeout(pressTimer); pressAt = null; };
  listEl.addEventListener('pointerdown', (ev) => {
    const row = getView() === 'tiles' && ev.button === 0 && ev.target.closest('.twl-row');
    if (!row) return;
    cancelPress();
    pressFired = false;
    pressAt = { x: ev.clientX, y: ev.clientY };
    pressTimer = setTimeout(() => {
      pressFired = true;
      openPlayerMenu(row, pressAt.x, pressAt.y);
      if (navigator.vibrate) navigator.vibrate(15);
    }, LONG_PRESS_MS);
  });
  listEl.addEventListener('pointermove', (ev) => {
    if (pressAt && Math.hypot(ev.clientX - pressAt.x, ev.clientY - pressAt.y) > 10) cancelPress();
  });
  listEl.addEventListener('pointerup', () => {
    if (pressFired) suppressClickUntil = Date.now() + 400; // the release must not open the profile
    cancelPress();
  });
  listEl.addEventListener('pointercancel', cancelPress);
  listEl.addEventListener('click', (ev) => {
    if (Date.now() < suppressClickUntil) { ev.preventDefault(); ev.stopPropagation(); }
  }, true);
  listEl.addEventListener('contextmenu', (ev) => {
    const row = getView() === 'tiles' && ev.target.closest('.twl-row');
    if (!row) return;
    ev.preventDefault();
    cancelPress();
    openPlayerMenu(row, ev.clientX, ev.clientY);
  });
  document.addEventListener('pointerdown', (ev) => {
    if (!pmenu.hidden && !pmenu.contains(ev.target)) hidePlayerMenu();
  }, true);

  function addFromInput(add) {
    const id = parseInt(input.value.replace(/\D/g, ''), 10);
    if (Number.isFinite(id) && id > 0) add(id);
    input.value = '';
  }
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') addFromInput(addPlayer); });

  const intervalInput = $('.twl-interval');
  intervalInput.value = getRefreshS();
  intervalInput.addEventListener('change', () => {
    const s = parseInt(intervalInput.value, 10);
    const clamped = Number.isFinite(s) ? Math.min(MAX_REFRESH_S, Math.max(MIN_REFRESH_S, s)) : DEFAULT_REFRESH_S;
    intervalInput.value = clamped;
    GM_setValue('refreshS', clamped);
    render();
  });

  // ---- Chain timer: read straight from Torn's sidebar (no API calls) -----------------------
  const CHAIN_ALERT_S = 90; // below 1:30 it blinks red
  const chainEnabled = () => GM_getValue('chainOn', true);

  // Finds the chain bar in the sidebar. Torn appends random suffixes to class names
  // (e.g. "bar-value___xY12"), hence partial matches; as a fallback via the label "Chain:".
  function findChainBar() {
    // Desktop: #barChain / chain-bar; mobile: <a class="chainBar___…"> (count only, no timer)
    const bar = document.querySelector('#barChain, [id^="barChain"], [class*="chain-bar"], a[class*="chainBar"]');
    if (bar) return bar;
    const label = [...document.querySelectorAll('#sidebar p, #sidebar span, [class*="sidebar"] p, [class*="sidebar"] span')]
      .find((el) => /^chain:?$/i.test(el.textContent.trim()));
    return label ? label.closest('a, li, div') : null;
  }

  // Torn abbreviates big numbers ("2615/5k"); sometimes the "k" is only in a CSS ::after.
  const CHAIN_VALUE_RE = /(\d[\d,.]*)\s*([kKmM]?)\s*\/\s*(\d[\d,.]*)\s*([kKmM]?)/;
  const pseudoText = (el, which) => {
    const c = getComputedStyle(el, which).content;
    return c && c !== 'none' && c !== 'normal' ? c.replace(/^["']|["']$/g, '') : '';
  };
  // Visible text incl. CSS ::before/::after of all nested elements. A space goes between
  // elements, otherwise values stick together ("4/10" + "02:57" -> "4/1002:57").
  const visibleText = (el) => pseudoText(el, '::before')
    + [...el.childNodes].map((n) => (n.nodeType === 1 ? ` ${visibleText(n)} ` : n.nodeType === 3 ? n.textContent : '')).join('')
    + pseudoText(el, '::after');
  function parseCount(num, suffix) {
    const mult = { k: 1e3, m: 1e6 }[suffix.toLowerCase()] || 1;
    // With a suffix "." is a decimal point (2.5k), without one "," and "." are thousands separators
    const n = mult > 1 ? parseFloat(num.replace(/,/g, '')) : parseInt(num.replace(/[,.]/g, ''), 10);
    return Math.round(n * mult);
  }
  const fmtCount = (n) => n.toLocaleString(getLang() === 'en' ? 'en-US' : 'de-DE');
  // The maximum is always the next bonus milestone (2615 -> 5k). The attack page doesn't show it,
  // so it is calculated there.
  const CHAIN_MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
  const nextMilestone = (cur) => CHAIN_MILESTONES.find((m) => m > cur) || null;

  function readSidebarChain() {
    const bar = findChainBar();
    if (!bar || panel.contains(bar)) return null;
    const valueEl = bar.querySelector('[class*="bar-value"], [class*="barValue"]');
    const timeEl = bar.querySelector('[class*="bar-timeleft"]');
    // Strip the time first so it isn't read as part of the maximum
    const rawValue = visibleText(valueEl || bar).replace(/\d{1,2}:\d{2}(?::\d{2})?/g, ' ').replace(/\s+/g, ' ');
    const m = rawValue.match(CHAIN_VALUE_RE);
    let value = valueEl ? rawValue.trim() : '';
    if (m) {
      const cur = parseCount(m[1], m[2]);
      let max = parseCount(m[3], m[4]);
      // The maximum is always a bonus milestone; anything else was misread
      if (!CHAIN_MILESTONES.includes(max) || max <= cur) max = nextMilestone(cur);
      value = max ? `${fmtCount(cur)} / ${fmtCount(max)}` : fmtCount(cur);
    }
    const time = timeEl ? timeEl.textContent.trim() : (visibleText(bar).match(/\d{1,2}:\d{2}(?::\d{2})?/) || [''])[0];
    return value || time ? { value, time } : null;
  }

  // Attack page (no sidebar): the chain shows as "2.630 (04:01)", the timer in
  // <span>(<span>04:01</span>)</span>. The found element is remembered so we don't search 4×/s.
  let attackTimerEl = null;
  const isAttackTimer = (el) => el && el.isConnected && !el.children.length
    && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(el.textContent.trim())
    && el.parentElement && /^\(\s*\d{1,2}:\d{2}(?::\d{2})?\s*\)$/.test(el.parentElement.textContent.trim());

  function readAttackChain() {
    const root = document.getElementById('attack-root');
    if (!root) return null;
    if (!isAttackTimer(attackTimerEl)) attackTimerEl = [...root.querySelectorAll('span')].find(isAttackTimer) || null;
    if (!attackTimerEl) return null;
    const time = attackTimerEl.textContent.trim();
    // Chain count: the number right before "(mm:ss)", searched up to three levels up
    let cur = null;
    let el = attackTimerEl.parentElement;
    for (let i = 0; i < 3 && el && cur == null; i++) {
      el = el.parentElement;
      if (!el || el.textContent.length > 60) break;
      const before = el.textContent.split('(')[0];
      const m = before.match(/(\d[\d,.]*)\s*([kKmM]?)\s*$/);
      if (m) cur = parseCount(m[1], m[2]);
    }
    if (cur == null) return { value: '', time };
    const max = nextMilestone(cur);
    return { value: max ? `${fmtCount(cur)} / ${fmtCount(max)}` : fmtCount(cur), time };
  }

  // Torn's mobile chain bar only shows the count ("4 / 10"), no timer. On touch screens the
  // timer therefore comes from the API (faction chain): every 6 s while a chain runs, counted
  // down locally in between. Without a running chain there is no polling – only one request on
  // page load and one whenever the count in Torn's bar changes (chain started, hit landed).
  const CHAIN_POLL_RUNNING_MS = 6000;
  let apiChain = null;          // { current, max, end (ms timestamp) }
  let apiChainAttempt = 0;      // last request (also failed ones), so errors don't hammer the API
  let apiChainLoading = false;
  let apiChainDenied = false;   // key can't read the faction chain – stop asking
  let apiChainCount = null;     // count last seen in Torn's bar
  // Only when something needs the chain: the chain timer (setting) or the bomb sound
  const useApiChain = () => IS_TOUCH && !apiChainDenied && !!getKey() && !isPaused()
    && (chainEnabled() || soundEnabled());
  const apiChainRunning = () => !!apiChain && apiChain.current > 0 && apiChain.end > Date.now();

  async function fetchApiChain() {
    const key = getKey();
    if (!key || apiChainLoading) return;
    apiChainLoading = true;
    const sent = Date.now();
    apiChainAttempt = sent;
    try {
      // "timestamp" bypasses Torn's API cache – a cached answer would carry an old "timeout"
      // and make the countdown jump back up every few seconds
      const d = await apiGet(`v2/faction/chain?timestamp=${Math.floor(sent / 1000)}`, key);
      if (d.error) {
        if (KEY_ERRORS.includes(d.error.code) || d.error.code === 7) apiChainDenied = true;
        return;
      }
      const c = d.chain || {};
      // Absolute break time: "seconds left" counted from the middle of the request (network delay)
      const end = Math.round((sent + Date.now()) / 2) + (c.timeout || 0) * 1000;
      // Torn only sends whole seconds – ignore differences below 1.5 s so the timer doesn't
      // wobble; a hit (count changed) or a real correction always goes through
      const keep = apiChain && apiChain.current === c.current && Math.abs(apiChain.end - end) < 1500;
      apiChain = { current: c.current || 0, max: c.max || 0, end: keep ? apiChain.end : end };
    } catch {
      // network hiccup – try again with the next poll
    } finally {
      apiChainLoading = false;
    }
  }

  function readApiChain(barCount) {
    if (!useApiChain()) return null;
    const now = Date.now();
    if (barCount != null && barCount !== apiChainCount) {
      const first = apiChainCount === null;
      apiChainCount = barCount;
      if (!first) setTimeout(fetchApiChain, 1500); // hit landed – the timer was reset
    }
    const due = apiChainAttempt === 0 || (apiChainRunning() && now - apiChainAttempt > CHAIN_POLL_RUNNING_MS);
    if (due) fetchApiChain();
    if (!apiChainRunning()) return null;
    const left = Math.ceil((apiChain.end - now) / 1000);
    const time = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
    const value = apiChain.max ? `${fmtCount(apiChain.current)} / ${fmtCount(apiChain.max)}` : fmtCount(apiChain.current);
    return { value, time };
  }

  // Page first (free); if it has no timer (mobile), fill in from the API
  const readChain = () => {
    const page = readSidebarChain() || readAttackChain();
    if (page && page.time) return page;
    return readApiChain(page ? page.value : null) || page;
  };

  const parseClock = (t) => {
    const parts = t.split(':').map(Number);
    return parts.length >= 2 && parts.every(Number.isFinite) ? parts.reduce((s, n) => s * 60 + n, 0) : null;
  };

  // FF score of the profile being viewed, for the header badge (touch header only)
  const BADGE_SWITCH_MS = 2000;
  const PROFILE_FF_RETRY_MS = 15000;
  let profileFfTry = { id: null, at: 0 };
  function profileFfBadge() {
    const id = currentProfileId();
    if (!id || !ffEnabled() || !getFfKey()) return null;
    const d = getFfCache()[id];
    // Not cached (or older than 30 min): fetch just this player, at most every 15 s
    if ((!d || Date.now() - d.fetched > FF_MAX_AGE_MS) && !ffLoading
        && (profileFfTry.id !== id || Date.now() - profileFfTry.at > PROFILE_FF_RETRY_MS)) {
      profileFfTry = { id, at: Date.now() };
      refreshFF([id]).then(render).catch(() => {});
    }
    if (!d) return ffLoading ? { text: 'FF …', color: '#bbb' } : null; // failed (e.g. key not registered): no badge
    const f = ffInfo(d, Math.floor(Date.now() / 1000));
    if (!f.color) return null; // FF Scouter has no estimate for this player
    return { text: `FF ${f.text}`, color: f.color };
  }

  function updateChain() {
    const box = $('.twl-chain');
    const show = chainEnabled();
    const chain = show || soundEnabled() ? readChain() : null;
    box.style.display = show && chain ? '' : 'none';
    const left = chain ? parseClock(chain.time) : null;
    updateBomb(left);
    // Header: the P always stays; while a chain runs a timer badge "⛓ mm:ss" sits next to it,
    // red and blinking below 1:30. On a profile page the badge shows that player's FF score;
    // with a running chain both take turns every 2 seconds.
    if (headerMode) {
      const running = show && left != null && left > 0; // chain timer switched off → only the P
      const alert = running && left < CHAIN_ALERT_S;
      const ff = profileFfBadge();
      const showFf = ff && (!running || Math.floor(Date.now() / BADGE_SWITCH_MS) % 2 === 1);
      let label = '';
      if (showFf) label = ff.text;
      else if (running) label = headerTimer.classList.contains('twl-compact') ? chain.time : `⛓ ${chain.time}`;
      if (headerTimer.textContent !== label) headerTimer.textContent = label;
      const color = showFf ? ff.color : '';
      if (headerTimer.style.color !== color) headerTimer.style.color = color;
      headerTimer.classList.toggle('twl-on', !!label);
      headerTimer.classList.toggle('twl-ffbadge', !!showFf);
      headerTimer.classList.toggle('twl-alert', alert && !showFf);
      headerTimer.classList.toggle('twl-alert-ring', alert && !!showFf); // chain still urgent while FF shows
    }
    const alert = show && left != null && left > 0 && left < CHAIN_ALERT_S;
    box.classList.toggle('twl-chain-alert', alert);
    panel.classList.toggle('twl-alert', alert);
    if (!show || !chain) return;
    $('.twl-chain-val').textContent = chain.value || '–';
    $('.twl-chain-time').textContent = chain.time || '–';
  }

  const chainToggle = $('.twl-chain-toggle');
  chainToggle.checked = chainEnabled();
  chainToggle.addEventListener('change', () => {
    GM_setValue('chainOn', chainToggle.checked);
    updateChain();
  });

  // ---- Bomb sound 💣: beeps from 1:30, faster and faster from 0:30, explosion at 0 ----------
  // Everything is synthesized with Web Audio, no sound file. Browsers only allow sound after a
  // click/key press on the page – in Torn you click all the time anyway.
  const BOMB_FAST_S = 30;      // from here the beeping speeds up
  const BOMB_LOOKAHEAD = 1.2;  // schedule beeps this far ahead (background tabs only tick 1×/s)
  const TAB_ID = Math.random().toString(36).slice(2);
  const soundEnabled = () => GM_getValue('soundOn', false);
  const soundVol = () => GM_getValue('soundVol', 60);
  // Gap between two beeps: 1 s, below 0:30 gliding down to 0.12 s
  const beepGap = (rem) => (rem > BOMB_FAST_S ? 1 : 0.12 + 0.38 * (rem / BOMB_FAST_S));

  let actx = null;
  let master = null;
  function audio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
      const comp = actx.createDynamicsCompressor(); // prevents clipping during the explosion
      comp.connect(actx.destination);
      master = actx.createGain();
      master.connect(comp);
    }
    master.gain.value = soundVol() / 100;
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    return actx;
  }
  const unlockAudio = () => { if (soundEnabled()) audio(); };
  document.addEventListener('pointerdown', unlockAudio, true);
  document.addEventListener('keydown', unlockAudio, true);

  const pendingBeeps = new Set();
  function beep(at, len) {
    const osc = actx.createOscillator();
    const lp = actx.createBiquadFilter();
    const g = actx.createGain();
    osc.type = 'square';
    osc.frequency.value = 1900;
    lp.type = 'lowpass';
    lp.frequency.value = 3500;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.35, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, at + len);
    osc.connect(lp).connect(g).connect(master);
    osc.start(at);
    osc.stop(at + len + 0.02);
    pendingBeeps.add(osc);
    osc.onended = () => pendingBeeps.delete(osc);
  }
  function cancelBeeps() {
    pendingBeeps.forEach((o) => { try { o.stop(); } catch { /* already over */ } });
    pendingBeeps.clear();
  }

  function noiseBuffer(sec, brown) {
    const len = Math.floor(actx.sampleRate * sec);
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      d[i] = brown ? (last = (last + 0.02 * w) / 1.02) * 3.5 : w;
    }
    return buf;
  }
  function explode(at) {
    // Rumble: brown noise whose filter closes slowly
    const rumble = actx.createBufferSource();
    rumble.buffer = noiseBuffer(3.2, true);
    const lp = actx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2500, at);
    lp.frequency.exponentialRampToValueAtTime(120, at + 2.8);
    const rg = actx.createGain();
    rg.gain.setValueAtTime(0.0001, at);
    rg.gain.exponentialRampToValueAtTime(1.6, at + 0.02);
    rg.gain.exponentialRampToValueAtTime(0.001, at + 3);
    rumble.connect(lp).connect(rg).connect(master);
    rumble.start(at);
    // Bang: short bright noise
    const crack = actx.createBufferSource();
    crack.buffer = noiseBuffer(0.3, false);
    const hp = actx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 800;
    const cg = actx.createGain();
    cg.gain.setValueAtTime(0.9, at);
    cg.gain.exponentialRampToValueAtTime(0.001, at + 0.25);
    crack.connect(hp).connect(cg).connect(master);
    crack.start(at);
    // Shock wave: low tone sliding downwards
    const thump = actx.createOscillator();
    thump.frequency.setValueAtTime(120, at);
    thump.frequency.exponentialRampToValueAtTime(30, at + 0.8);
    const tg = actx.createGain();
    tg.gain.setValueAtTime(1.2, at);
    tg.gain.exponentialRampToValueAtTime(0.001, at + 1.2);
    thump.connect(tg).connect(master);
    thump.start(at);
    thump.stop(at + 1.3);
  }
  function boomFx(delayMs = 0) {
    setTimeout(() => {
      const flash = document.createElement('div');
      flash.id = 'twl-flash';
      document.body.appendChild(flash);
      setTimeout(() => flash.remove(), 1300);
      panel.classList.remove('twl-boom');
      void panel.offsetWidth; // restart the animation
      panel.classList.add('twl-boom');
      setTimeout(() => panel.classList.remove('twl-boom'), 1100);
    }, delayMs);
  }

  // Several Torn tabs open? Only one beeps – preferably the visible one.
  function isSoundTab() {
    const now = Date.now();
    const vis = document.visibilityState === 'visible';
    const o = GM_getValue('soundTab', null);
    const mine = !o || o.id === TAB_ID || now - o.t > 3000 || (vis && !o.vis);
    if (mine && (!o || o.id !== TAB_ID || o.vis !== vis || now - o.t > 1000)) GM_setValue('soundTab', { id: TAB_ID, t: now, vis });
    return mine;
  }
  window.addEventListener('pagehide', () => {
    const o = GM_getValue('soundTab', null);
    if (o && o.id === TAB_ID) GM_setValue('soundTab', null);
  });

  // Armed bomb: end = time of 0:00 (performance.now), shown = last read seconds,
  // next = audio time of the next scheduled beep
  let bomb = null;
  function disarm() {
    if (!bomb) return;
    bomb = null;
    cancelBeeps();
  }
  function detonate() {
    disarm();
    if (isSoundTab()) {
      const ctx = audio();
      if (ctx && ctx.state === 'running') explode(ctx.currentTime + 0.02);
    }
    boomFx();
  }
  function updateBomb(left) {
    if (!soundEnabled()) { disarm(); return; }
    const now = performance.now();
    // Timer ran to 0 (or the chain display vanished) while the bomb was ticking
    if (bomb && (left == null || left === 0) && now >= bomb.end - 1500) { detonate(); return; }
    // No timer, already 0 or back above 1:30 (hit landed): defused
    if (left == null || left <= 0 || left >= CHAIN_ALERT_S) { disarm(); return; }
    if (!bomb || left > bomb.shown) {
      disarm();
      bomb = { shown: left, end: now + left * 1000, next: null };
    } else if (left < bomb.shown) {
      bomb.shown = left;
      bomb.end = now + left * 1000;
    }
    if (!isSoundTab()) { cancelBeeps(); bomb.next = null; return; }
    const ctx = audio();
    if (!ctx || ctx.state !== 'running') return;
    const endA = ctx.currentTime + (bomb.end - now) / 1000;
    if (bomb.next == null || bomb.next < ctx.currentTime) bomb.next = ctx.currentTime + 0.02;
    while (bomb.next < ctx.currentTime + BOMB_LOOKAHEAD) {
      const rem = endA - bomb.next;
      if (rem < 0.08) break;
      const gap = beepGap(rem);
      beep(bomb.next, Math.min(0.09, gap * 0.6));
      bomb.next += gap;
    }
  }

  // Preview: the last 6 seconds + explosion
  function testBomb() {
    const ctx = audio();
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.1;
    const DUR = 6;
    for (let t = 0; DUR - t > 0.08; ) {
      const gap = beepGap(DUR - t);
      beep(t0 + t, Math.min(0.09, gap * 0.6));
      t += gap;
    }
    explode(t0 + DUR);
    boomFx((DUR + 0.1) * 1000);
  }

  const soundToggle = $('.twl-sound-toggle');
  const volInput = $('.twl-sound-vol');
  soundToggle.checked = soundEnabled();
  volInput.value = soundVol();
  soundToggle.addEventListener('change', () => {
    GM_setValue('soundOn', soundToggle.checked);
    if (!soundToggle.checked) { disarm(); return; }
    const ctx = audio();
    if (ctx) beep(ctx.currentTime + 0.05, 0.09); // short confirmation beep
  });
  volInput.addEventListener('input', () => {
    GM_setValue('soundVol', Number(volInput.value));
    if (master) master.gain.value = soundVol() / 100;
  });

  const ffToggle = $('.twl-ff-toggle');
  ffToggle.checked = ffEnabled();
  ffToggle.addEventListener('change', () => {
    GM_setValue('ffOn', ffToggle.checked);
    if (ffToggle.checked) refreshFF(shownIds()).then(render);
    render();
  });

  const hitsToggle = $('.twl-hits-toggle');
  hitsToggle.checked = hitsEnabled();
  hitsToggle.addEventListener('change', () => {
    GM_setValue('hitsOn', hitsToggle.checked);
    const key = getKey();
    if (hitsToggle.checked && key) refreshHits(key).then(render);
    render();
  });

  // ---- Nyan Cat 🌈 (just for the lols) ---------------------------------------
  const NYAN_SPEED = 170;          // pixels per second along the border
  const NYAN_PAUSE_S = [20, 90];   // random pause between two laps
  const NYAN_TRAIL = 200;          // length of the rainbow trail in pixels
  const NYAN_STEP = 3;             // spacing of the trail pieces (smaller = smoother)
  const NYAN_CORNER = 16;          // radius the cat uses to run around corners
  const NYAN_TAIL_GAP = 13;        // distance cat center -> trail start (behind the Pop-Tart)

  // The trail consists of many thin rainbow pieces, each placed on the track behind the cat –
  // that way it bends around the corners too.
  const trail = document.createElement('div');
  trail.id = 'twl-nyan-trail';
  trail.innerHTML = '<div class="twl-rb"></div>'.repeat(Math.ceil(NYAN_TRAIL / NYAN_STEP));
  const trailParts = [...trail.children];
  document.body.appendChild(trail);

  const nyan = document.createElement('div');
  nyan.id = 'twl-nyan';
  nyan.innerHTML = `
    <svg viewBox="0 0 34 20" width="34" height="20" shape-rendering="crispEdges">
      <rect x="0" y="9" width="4" height="3" fill="#999"/>
      <rect x="3" y="0" width="20" height="17" rx="2" fill="#f7c58c"/>
      <rect x="5" y="2" width="16" height="13" rx="1" fill="#ff99ff"/>
      <g fill="#ff3399">
        <rect x="8" y="4" width="2" height="2"/><rect x="14" y="3" width="2" height="2"/>
        <rect x="11" y="8" width="2" height="2"/><rect x="7" y="11" width="2" height="2"/>
        <rect x="15" y="11" width="2" height="2"/>
      </g>
      <g fill="#999">
        <rect x="5" y="16" width="3" height="3"/><rect x="10" y="16" width="3" height="3"/>
        <rect x="18" y="16" width="3" height="3"/><rect x="23" y="16" width="3" height="3"/>
      </g>
      <polygon points="19,7 20,2 24,5" fill="#999"/><polygon points="32,7 31,2 27,5" fill="#999"/>
      <rect x="18" y="5" width="15" height="11" rx="3" fill="#999"/>
      <rect x="22" y="8" width="2" height="2" fill="#000"/><rect x="28" y="8" width="2" height="2" fill="#000"/>
      <rect x="22" y="8" width="1" height="1" fill="#fff"/><rect x="28" y="8" width="1" height="1" fill="#fff"/>
      <rect x="20" y="11" width="2" height="2" fill="#ff9999"/><rect x="30" y="11" width="2" height="2" fill="#ff9999"/>
      <rect x="24" y="12" width="4" height="1" fill="#000"/>
    </svg>`;
  document.body.appendChild(nyan);

  const nyanEnabled = () => GM_getValue('nyan', true);
  let nyanTimer = null;
  let nyanFrame = null;

  function scheduleNyan(delayMs) {
    clearTimeout(nyanTimer);
    if (!nyanEnabled()) return;
    const [min, max] = NYAN_PAUSE_S;
    nyanTimer = setTimeout(runNyan, delayMs ?? (min + Math.random() * (max - min)) * 1000);
  }

  function stopNyan() {
    clearTimeout(nyanTimer);
    cancelAnimationFrame(nyanFrame);
    nyan.style.display = trail.style.display = 'none';
  }

  // Track: rectangle with rounded corners, inside the border (so the cat isn't cut off at the
  // screen edge), clockwise from the top left. at(d) returns [x, y, heading°].
  const NYAN_INSET = 10;
  function nyanPath(panelRect) {
    const x = panelRect.left + NYAN_INSET;
    const y = panelRect.top + NYAN_INSET;
    const w = Math.max(0, panelRect.width - 2 * NYAN_INSET);
    const h = Math.max(0, panelRect.height - 2 * NYAN_INSET);
    const R = Math.min(NYAN_CORNER, w / 2, h / 2);
    const sw = w - 2 * R;
    const sh = h - 2 * R;
    const arc = (Math.PI * R) / 2;
    const corner = (cx, cy, startDeg, t) => {
      const a = startDeg + (arc ? t / arc : 1) * 90;
      const rad = (a * Math.PI) / 180;
      return [cx + R * Math.cos(rad), cy + R * Math.sin(rad), a + 90];
    };
    const segs = [
      [sw, (t) => [x + R + t, y, 0]],
      [arc, (t) => corner(x + w - R, y + R, -90, t)],
      [sh, (t) => [x + w, y + R + t, 90]],
      [arc, (t) => corner(x + w - R, y + h - R, 0, t)],
      [sw, (t) => [x + w - R - t, y + h, 180]],
      [arc, (t) => corner(x + R, y + h - R, 90, t)],
      [sh, (t) => [x, y + h - R - t, 270]],
      [arc, (t) => corner(x + R, y + R, 180, t)],
    ];
    return {
      length: segs.reduce((sum, [l]) => sum + l, 0),
      at(d) {
        for (const [l, f] of segs) {
          if (d <= l) return f(d);
          d -= l;
        }
        return segs[0][1](0);
      },
    };
  }

  const panelCollapsed = () => panel.classList.contains('twl-collapsed');

  function runNyan() {
    if (!nyanEnabled()) return;
    if (document.hidden || panelCollapsed()) return scheduleNyan(); // no laps around a collapsed panel
    const start = performance.now();
    nyan.style.display = trail.style.display = 'block';
    const step = (t) => {
      const path = nyanPath(panel.getBoundingClientRect()); // live, in case the panel is being resized
      const d = ((t - start) / 1000) * NYAN_SPEED;
      // One lap: the cat runs back to the start, then the trail "flows" after it.
      // Collapsed in the middle of a lap? Then stop right away.
      if (d - NYAN_TAIL_GAP - NYAN_TRAIL >= path.length || panelCollapsed()) {
        nyan.style.display = trail.style.display = 'none';
        scheduleNyan();
        return;
      }

      if (d <= path.length) {
        const [x, y, a] = path.at(d);
        nyan.style.opacity = Math.max(0, Math.min(1, d / 20, (path.length - d) / 20)); // fade in/out smoothly
        nyan.style.transform = `translate(${x - 17}px, ${y - 10}px) rotate(${a}deg)`;
      } else {
        nyan.style.opacity = 0;
      }

      const wave = Math.floor(t / 150) % 2; // rainbow bobs in steps like the original
      trailParts.forEach((el, k) => {
        const dk = d - NYAN_TAIL_GAP - k * NYAN_STEP;
        if (dk < 0 || dk > path.length) {
          el.style.opacity = 0;
          return;
        }
        const [x, y, a] = path.at(dk);
        const rad = (a * Math.PI) / 180;
        const off = (Math.floor((k * NYAN_STEP) / 12) + wave) % 2 ? 1 : -1; // across the running direction
        el.style.opacity = 1 - (k / trailParts.length) ** 2; // trail end fades out
        el.style.transform = `translate(${x - 2.5 - Math.sin(rad) * off}px, ${y - 7.5 + Math.cos(rad) * off}px) rotate(${a}deg)`;
      });

      nyanFrame = requestAnimationFrame(step);
    };
    nyanFrame = requestAnimationFrame(step);
  }

  const nyanToggle = $('.twl-nyan-toggle');
  nyanToggle.checked = nyanEnabled();
  function applyNyan() {
    nyanToggle.checked = nyanEnabled();
    stopNyan();
    if (nyanEnabled()) scheduleNyan(800); // run a lap right away when switched on
  }
  nyanToggle.addEventListener('change', () => {
    GM_setValue('nyan', nyanToggle.checked);
    applyNyan();
  });

  // ---- Touch settings grid: mirror the current state onto tiles and segments -----------------
  const gridVol = $('.twl-g-vol');
  gridVol.addEventListener('input', () => {
    volInput.value = gridVol.value;
    volInput.dispatchEvent(new Event('input'));
  });
  function syncGrid() {
    const setOn = (tile, on) => {
      tile.classList.toggle('twl-on', on);
      const pill = tile.querySelector('.twl-pill');
      const txt = on ? t('tileOn') : t('tileOff');
      if (pill && pill.textContent !== txt) pill.textContent = txt;
    };
    const setText = (el, txt) => { if (el.textContent !== txt) el.textContent = txt; };
    for (const tile of panel.querySelectorAll('.twl-tile[data-for]')) setOn(tile, $(tile.dataset.for).checked);
    setOn($('.twl-tile[data-tile="pause"]'), isPaused());

    const key = $('.twl-g-key');
    setText(key, getKey() ? `✓ ${t('apiKeySet')}` : t('apiKeyMissing'));
    key.classList.toggle('twl-ff-err', !getKey());
    const ffErr = GM_getValue('ffError', '');
    const ffKey = $('.twl-g-ffkey');
    setText(ffKey, ffErr || (GM_getValue('ffKey', '') ? t('ffOwnKey') : getKey() ? t('ffWatchlistKey') : t('ffNoKey')));
    ffKey.classList.toggle('twl-ff-err', !!ffErr);
    const reload = $('.twl-g-ffreload');
    reload.disabled = !ffEnabled() || ffLoading || !getFfKey();
    setText(reload.querySelector('.twl-ic'), ffLoading ? '⏳' : '🔄');

    for (const b of panel.querySelectorAll('[data-act="seg-lang"]')) b.classList.toggle('twl-on', b.dataset.v === getLang());
    for (const b of panel.querySelectorAll('[data-act="seg-view"]')) b.classList.toggle('twl-on', b.dataset.v === getView());
    const secs = getRefreshS();
    for (const b of panel.querySelectorAll('[data-act="seg-interval"]')) b.classList.toggle('twl-on', Number(b.dataset.v) === secs);
    const rate = $('.twl-rate');
    const hint = $('.twl-g-rate');
    setText(hint, (REFRESH_PRESETS.includes(secs) ? '' : `${t('customInterval', secs)} · `) + rate.textContent);
    hint.classList.toggle('twl-warn', rate.classList.contains('twl-warn'));

    $('.twl-g-sound').hidden = !soundToggle.checked;
    if (document.activeElement !== gridVol) gridVol.value = GM_getValue('soundVol', 60);
  }

  // ---- Export / import of the settings (incl. API key, players, factions) -------------------
  const EXPORT_APP = 'torn-war-watchlist';

  function exportSettings() {
    const settings = {};
    for (const k of Object.keys(SETTINGS)) {
      const v = GM_getValue(k, undefined);
      if (v !== undefined) settings[k] = v;
    }
    const data = { app: EXPORT_APP, version: typeof GM_info !== 'undefined' ? GM_info.script.version : '', exported: new Date().toISOString(), settings };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `torn-watchlist-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importSettings(text) {
    let data;
    try { data = JSON.parse(text); } catch { alert(t('importBadJson')); return; }
    if (!isObj(data) || data.app !== EXPORT_APP || !isObj(data.settings)) {
      alert(t('importNotOurs'));
      return;
    }
    const s = { ...data.settings };
    // Bring players and factions into the expected shape, drop broken entries
    const validId = (e) => isObj(e) && Number.isInteger(e.id) && e.id > 0;
    if (Array.isArray(s.list)) {
      s.list = s.list.filter(validId).map((e) => ({ name: null, ts: null, error: null, ...e }));
    }
    if (Array.isArray(s.factions)) {
      s.factions = s.factions.filter(validId).map((f) => ({
        name: null, tag: '', error: null, ...f,
        hidden: Array.isArray(f.hidden) ? f.hidden.filter(Number.isInteger) : [],
        members: Array.isArray(f.members) ? f.members.filter(validId) : [],
      }));
    }
    const valid = Object.keys(SETTINGS).filter((k) => k in s && SETTINGS[k](s[k]));
    if (!valid.length) { alert(t('importEmpty')); return; }
    const players = Array.isArray(s.list) ? s.list.length : 0;
    const factions = Array.isArray(s.factions) ? s.factions.length : 0;
    if (!confirm(t('importConfirm', players, factions, !!s.apiKey))) return;

    const keyChanged = 'apiKey' in s && s.apiKey !== getKey();
    for (const k of valid) GM_setValue(k, s[k]);
    if (keyChanged) GM_setValue('hits', null); // hits belong to the old account
    GM_setValue('hitsDeniedKey', '');
    GM_setValue('lastRefresh', 0);
    saveBackup(); // back up right away, not after the delay

    // Apply everything right away
    intervalInput.value = getRefreshS();
    hitsToggle.checked = hitsEnabled();
    chainToggle.checked = chainEnabled();
    soundToggle.checked = soundEnabled();
    ffToggle.checked = ffEnabled();
    if ('ffKey' in s) GM_setValue('ffCache', {});
    volInput.value = soundVol();
    if (master) master.gain.value = soundVol() / 100;
    if (!soundEnabled()) disarm();
    applyNyan();
    applyLayout();
    applyLang();
    applyTab();
    render();
    updateChain();
    refreshAll(true);
  }

  const importInput = $('.twl-import-input');
  importInput.addEventListener('change', () => {
    const file = importInput.files[0];
    importInput.value = '';
    if (!file) return;
    file.text().then(importSettings, () => alert(t('importReadFail')));
  });

  // ---- Ranked war page: ➕ and copy buttons next to every enemy's name ---------------------
  // Torn renders the member list with React and redraws rows all the time, so a
  // MutationObserver re-adds missing buttons. Name and ID come straight from the row.
  const WAR_ROW_SEL = 'ul[class*="members-list"] > li[class*="enemy"]';
  const COPY_ICON = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';

  function warRowInfo(li) {
    const link = li.querySelector('a[href*="profiles.php?XID="]');
    if (!link) return null;
    const id = parseInt(new URL(link.getAttribute('href'), location.origin).searchParams.get('XID'), 10);
    if (!id) return null;
    const nameEl = li.querySelector('.honor-text:not(.honor-text-svg)');
    const name = (nameEl && nameEl.textContent.trim())
      || (link.getAttribute('aria-label') || '').replace(/^View profile of\s*/i, '').trim()
      || String(id);
    return { id, name };
  }

  function decorateWarRows() {
    const rows = document.querySelectorAll(WAR_ROW_SEL);
    if (!rows.length) return;
    const onList = new Set(shownIds());
    for (const li of rows) {
      const info = warRowInfo(li);
      if (!info) continue;
      let box = li.querySelector('.twl-war-actions');
      // React may reuse a row for another player – then rebuild the buttons
      if (box && box.dataset.id !== String(info.id)) { box.remove(); box = null; }
      if (!box) {
        // The name cell is a direct child of the row (class "member … member___xY12")
        const cell = [...li.children].find((el) => /(^|\s)member/.test(el.className)) || li.firstElementChild;
        if (!cell) continue;
        cell.classList.add('twl-war-cell');
        box = document.createElement('span');
        box.className = 'twl-war-actions';
        box.dataset.id = info.id;
        box.innerHTML = '<button type="button" class="twl-war-btn" data-twl="add"></button>'
          + `<button type="button" class="twl-war-btn" data-twl="copy">${COPY_ICON}</button>`;
        cell.appendChild(box);
      }
      box.dataset.name = info.name;
      const add = box.querySelector('[data-twl="add"]');
      const on = onList.has(info.id);
      // Only touch the DOM when something changed, so the observer doesn't loop
      if (add.dataset.on !== String(on) || add.title !== t(on ? 'warOnList' : 'warAdd')) {
        add.dataset.on = String(on);
        add.classList.toggle('twl-on', on);
        add.textContent = on ? '✓' : '+';
        add.title = t(on ? 'warOnList' : 'warAdd');
      }
      const copy = box.querySelector('[data-twl="copy"]');
      // Restore the icon after the ✓/✕ feedback (also if the row was redrawn meanwhile)
      if (!(+copy.dataset.busyUntil > Date.now()) && (copy.title !== t('warCopy') || !copy.querySelector('svg'))) {
        delete copy.dataset.busyUntil;
        copy.innerHTML = COPY_ICON;
        copy.title = t('warCopy');
      }
    }
  }

  // Copies "Name [ID]" as a link to the profile (HTML) plus a plain text version for chats
  async function copyPlayer(name, id) {
    const url = `https://www.torn.com/profiles.php?XID=${id}`;
    const label = `${name} [${id}]`;
    const text = `${label} – ${url}`;
    const html = `<a href="${url}">${esc(label)}</a>`;
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
      return;
    }
    // Fallback for browsers without ClipboardItem: plain text only
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('copy failed');
  }

  // Capture phase, so Torn's own row handlers don't see the click
  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.twl-war-btn');
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    const box = btn.closest('.twl-war-actions');
    const id = parseInt(box.dataset.id, 10);
    if (btn.dataset.twl === 'add') {
      if (btn.dataset.on === 'true') removePlayer(id);
      else addPlayer(id);
      decorateWarRows();
      return;
    }
    const done = (ok) => {
      btn.dataset.busyUntil = Date.now() + 1200;
      btn.textContent = ok ? '✓' : '✕';
      btn.title = t(ok ? 'warCopied' : 'warCopyFailed');
      setTimeout(decorateWarRows, 1300); // puts the copy icon back
    };
    copyPlayer(box.dataset.name || String(id), id).then(() => done(true), () => done(false));
  }, true);

  let warTimer = null;
  new MutationObserver(() => {
    if (warTimer) return;
    warTimer = setTimeout(() => { warTimer = null; decorateWarRows(); syncHeaderMode(); }, 200);
  }).observe(document.body, { childList: true, subtree: true });
  decorateWarRows();

  // Apply changes from other tabs
  GM_addValueChangeListener('nyan', (_k, _o, _n, remote) => { if (remote) applyNyan(); });
  GM_addValueChangeListener('list', (_k, _o, _n, remote) => { if (remote) render(); });
  GM_addValueChangeListener('factions', (_k, _o, _n, remote) => { if (remote) render(); });
  GM_addValueChangeListener('side', (_k, _o, _n, remote) => { if (remote) applyLayout(); });
  GM_addValueChangeListener('collapsed', (_k, _o, _n, remote) => { if (remote) applyLayout(); });
  GM_addValueChangeListener('size', (_k, _o, _n, remote) => { if (remote) applyLayout(); });
  GM_addValueChangeListener('pos', (_k, _o, _n, remote) => { if (remote) applyLayout(); });
  GM_addValueChangeListener('refreshS', (_k, _o, n, remote) => { if (remote) intervalInput.value = n; });
  GM_addValueChangeListener('hitsOn', (_k, _o, n, remote) => { if (remote) hitsToggle.checked = n; });
  GM_addValueChangeListener('chainOn', (_k, _o, n, remote) => { if (remote) chainToggle.checked = n; });
  GM_addValueChangeListener('soundOn', (_k, _o, n, remote) => { if (remote) soundToggle.checked = n; });
  GM_addValueChangeListener('ffOn', (_k, _o, n, remote) => { if (remote) { ffToggle.checked = n; render(); } });
  GM_addValueChangeListener('lang', (_k, _o, _n, remote) => { if (remote) { applyLang(); render(); } });
  GM_addValueChangeListener('view', (_k, _o, _n, remote) => { if (remote) { viewSelect.value = getView(); render(); } });
  GM_addValueChangeListener('soundVol', (_k, _o, n, remote) => {
    if (!remote) return;
    volInput.value = n;
    if (master) master.gain.value = n / 100;
  });

  // ---- Honor tracker: data -----------------------------------------------------------------
  // Honor guide data, difficulty tiers and progress mapping adapted from
  // "Torn City - Merit Tracker" v3.2 by Solenya [4053619], https://greasyfork.org/scripts/579300
  // Licensed under the MIT License:
  //   Permission is hereby granted, free of charge, to any person obtaining a copy of this software
  //   and associated documentation files (the "Software"), to deal in the Software without
  //   restriction, including without limitation the rights to use, copy, modify, merge, publish,
  //   distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
  //   Software is furnished to do so, subject to the following conditions: The above copyright
  //   notice and this permission notice shall be included in all copies or substantial portions of
  //   the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
  // Only the data is used here – no requests to other servers (no fonts, no Greasy Fork check).
  // Tier colors; names and descriptions come from I18N (honTierNames / honTierDescs).
  const HON_TIER_COLOR = { 1: '#facc15', 2: '#60a5fa', 3: '#fb923c', 4: '#f87171', 5: '#c084fc', 6: '#6b7280' };
  const HON_TIER_BG = { 1: '#292100', 2: '#0a1628', 3: '#2d1500', 4: '#2d0a0a', 5: '#1a0a28', 6: '#111827' };

  // Honor ID -> d: difficulty tier (1 instant … 5 complex), g: guide (English)
  const HON_DB = {
    838:  { d:1, g:"Defeat two players who are married to each other (in any order). The well-known pair monkey_D and Left4Dead12 are a reliable target — defeat one, then the other." },
    367:  { d:1, g:"Buy Ipecac Syrup from the City (~$45k) and use it from your inventory — it instantly hospitalizes you. Alternatively, use a blood bag of the wrong type (requires Intravenous Therapy education course)." },
    902:  { d:1, g:"Attack pops333 using ONLY your fists so you lose — he beats you with a trout. Unequip all weapons first or use fists only. You want to lose this fight deliberately." },
    230:  { d:1, g:"Defeat any player who currently has the Domino Effect honor equipped on their profile. L3Milk is a well-known low-stat player who displays it and is an easy kill." },
    639:  { d:1, g:"Join an attack as an assist — you must NOT deliver the killing blow. Best method: during Loot Rangers NPC events, join the attack. Or have a friend start an attack on a target and you click Assist without finishing them." },
    254:  { d:1, g:"Kill any player from full health in a single attack (one-hit-kill). Target low-level inactive players who have 100% life. Just keep attacking them until it procs." },
    12:   { d:1, g:"Make any deposit in the City Bank. Even $1 for 1 week counts. Go to City → Bank and put any amount in for any duration." },
    371:  { d:1, g:"Complete the intro mission 'Introduction: Duke'. This is given automatically to new players. Check your Missions tab — it's essentially free XP." },
    39:   { d:1, g:"Win any 5 attacks. Attack low-level inactive players to get this fast." },
    40:   { d:1, g:"Win 20 attacks. Keep attacking low-level inactives." },
    41:   { d:1, g:"Win 50 attacks total." },
    42:   { d:1, g:"Win 100 attacks total." },
    43:   { d:4, g:"Win 250 attacks total." },
    18:   { d:1, g:"Reach level 10. Just keep playing — this comes naturally." },
    20:   { d:1, g:"Achieve 25 critical hits. These accumulate naturally as you attack anyone." },
    253:  { d:1, g:"Participate in a faction chain of at least 10 hits. Just join during any chain your faction runs." },
    255:  { d:1, g:"Participate in a faction chain of at least 100 hits. Join during a planned chain event." },
    687:  { d:1, g:"Reach 100 total battle stats combined (Str+Spd+Dex+Def). Happens naturally after a few gym sessions." },
    720:  { d:1, g:"Reach 1,000 total battle stats. A few days of regular gym training." },
    686:  { d:1, g:"Reach 10,000 total battle stats. Regular gym use over a couple of weeks." },
    520:  { d:1, g:"Donate a cumulative $100,000 to the Church (City → Church → Donate). Donations stack over time, doesn't need to be all at once." },
    521:  { d:1, g:"Donate a cumulative $1,000,000 to the Church (City → Church → Donate). Stacks over time." },
    1326: { d:1, g:"Go to Crimes → Search for Cash → Beach. Search repeatedly — you'll randomly dig up sand. Doesn't take long." },
    1349: { d:1, g:"Go to Crimes → Burglary, click the area dropdown (shows 'Any Residential' etc.) and pick a specific target like 'Beach Hut', then click Locate. Done — costs 9 nerve." },
    665:  { d:1, g:"Participate in defeating a lootable NPC (Duke, Jimmy, Leslie). Check yata.yt for the Loot Rangers schedule and just hit the NPC at least once — you don't need top damage." },
    288:  { d:3, g:"Reset your merits from the Merits page. The first reset may be free; after that it costs 500 points (~$19M). This wipes your current merit allocations — plan accordingly." },
    606:  { d:1, g:"Achieve 100 total awards (honors + medals combined). Just keep playing and collecting awards naturally." },
    653:  { d:4, g:"Complete 10 education courses total. Each course takes anywhere from 3 days to over a month — just keep one queued at all times in the Education section." },
    659:  { d:4, g:"Complete 25 education courses total. Courses range from 3 days to 30+ days each. Keep one queued constantly and this comes naturally over time." },
    845:  { d:1, g:"Go to Newspaper → Chronicles, open any chronicle, and stay on the page for about 15 minutes without closing or navigating away." },
    1014: { d:4, g:"Achieve skill level 100 in Crimes → Search for Cash. Requires hundreds of attempts over many days. Do it passively as a daily crime alongside other activities." },

    140:  { d:4, g:"Fire 1,000 rounds total. Equip a minigun for fastest accumulation." },
    141:  { d:4, g:"Achieve 100 finishing hits with heavy artillery (RPG, M72 LAW, etc.). Set attack preference to 100% primary, equip heavy artillery, attack low-level inactives." },
    142:  { d:4, g:"Achieve 100 finishing hits with clubbing weapons (baseball bat, nunchaku). Set preference to 100% melee, equip clubbing weapon, attack inactives." },
    143:  { d:4, g:"Achieve 100 finishing hits with temporary weapons (grenades, HEG). Set preference to 100% temporary and use on inactives — these are one-use items." },
    144:  { d:4, g:"Achieve 100 finishing hits with machine guns (Para, Minigun). Set preference to 100% primary, equip machine gun, attack inactives." },
    145:  { d:4, g:"Achieve 100 finishing hits with pistols. Set preference to 100% secondary, equip pistol (QSZ-92, Desert Eagle), attack low-level inactives." },
    146:  { d:4, g:"Achieve 100 finishing hits with rifles (Armalite, SA80). Set preference to 100% primary, equip rifle, attack inactives." },
    147:  { d:4, g:"Achieve 100 finishing hits with shotguns. Jackhammer works well. Set preference to 100% primary, equip shotgun, attack inactives." },
    148:  { d:4, g:"Achieve 100 finishing hits with SMGs (BT MP9, Uzi). Set preference to 100% primary, equip SMG, attack inactives." },
    149:  { d:4, g:"Achieve 100 finishing hits with piercing weapons (daggers, spears). Always keep a dagger equipped — accumulates passively over time." },
    150:  { d:4, g:"Achieve 100 finishing hits with slashing weapons (swords, kodachi). Equip a slashing weapon and attack low-level inactives." },
    151:  { d:4, g:"Fire 10,000 rounds total. Use a minigun — comes naturally with regular attacking over time." },
    515:  { d:4, g:"Achieve 100 finishing hits with fists or Kick. Fists are always available — use them for the killing blow on low-threat targets. Kick requires completing Introduction to Self-Defense + Kick-boxing education." },
    740:  { d:5, g:"Deal at least 5,000 damage in a single hit. Requires high Strength, LSD (+35% stats), Hollow Point ammo, high-damage weapon with max merits, and a fully unarmored target." },
    741:  { d:5, g:"Deal at least 10,000 damage in one hit. Stack LSD + Epinephrine + Hollow Point ammo + max weapon merits against a completely unarmored low-defense target." },
    786:  { d:5, g:"Deal at least 15,000 damage in one hit. Everything from Obliteration but even harder — requires very high Strength and near-perfect conditions." },
    834:  { d:4, g:"Fire 100,000 rounds total. Long-term grind — use a minigun. Takes many months of regular attacking." },
    836:  { d:5, g:"Fire 1,000,000 rounds total. Extremely long-term — years of regular heavy attacking with a minigun or egg launcher." },
    793:  { d:3, g:"Use 1,000 rounds of special ammo total. Buy from the Mission credit shop (cheapest source). All types of special ammo count cumulatively." },
    791:  { d:3, g:"Use 10,000 rounds of special ammo total. Keep buying mission ammo and using it in attacks — long-term grind." },
    851:  { d:3, g:"Own at least 20 weapon mods simultaneously. Buy with Mission Credits, always make sure to keep enough credits for a good book on hand - Tier 1 mods are cheap, Tier 3-4 are very expensive." },
    491:  { d:3, g:"Equip two Tier 3 or Tier 4 weapon mods on a single weapon simultaneously. High-tier mods are rare and expensive on the item market." },
    942:  { d:4, g:"Use 2,500 Hollow Point rounds total. Buy from the Mission credit shop — budget your credits since Hollow Points are the most popular ammo type." },
    943:  { d:4, g:"Use 2,500 Piercing rounds total. Buy from the Mission credit shop." },
    944:  { d:4, g:"Use 2,500 Incendiary rounds total. Buy from the Mission credit shop." },
    945:  { d:4, g:"Use 2,500 Tracer rounds total. Buy from the Mission credit shop." },
    951:  { d:5, g:"Use a 12 Gauge Incendiary round in an attack. These only spawn as mission rewards when you have a shotgun equipped as primary or secondary. Equip a shotgun and keep doing missions — completely RNG." },
    778:  { d:5, g:"Achieve 100% weapon experience on 25 different weapons. Requires enormous amounts of attacking across many weapon types — very long-term goal." },

    228:  { d:4, g:"Achieve 1,000 attacks AND 1,000 defends. Attacks come from regular play. Defends happen when others attack you and lose — buy losses from the Attack forum (~$250k each) to speed it up." },
    232:  { d:4, g:"Collect 250 bounties total. Hunt the bounty board regularly, or ask friends to place $50 bounties on your mission targets so you can claim them after." },
    236:  { d:3, g:"Earn $10,000,000 total from bounty hunting. Ask a friend to bounty a third player for $10M (costs ~$5M in fees), then attack and collect. Or hunt real bounties slowly over time." },
    270:  { d:4, g:"Stalemate 100 times total. A stalemate happens after 25 turns with no winner. Equip a Pillow and attack a similarly-weak target — just hit 25 turns and neither of you should die." },
    414:  { d:4, g:"Achieve 3 consecutive headshots in a single attack. Headshots are random — comes naturally with heavy regular play." },
    490:  { d:4, g:"Assist in 250 attacks total. Join NPC attacks (Loot Rangers events) or assist faction members during wars. You must NOT deliver the killing blow." },
    517:  { d:4, g:"Achieve 100 one-hit kills total. Attack low-level inactive players repeatedly — every kill from full health in one hit counts. Comes naturally with decent stats over time." },
    601:  { d:4, g:"Achieve 10,000 total hits (individual attack rounds). Very long-term — comes from years of heavy attacking." },
    608:  { d:5, g:"Deal exactly 1,337 damage in a single hit. Completely random — no way to force it. Just keep attacking with a mid-damage weapon and it will eventually occur." },
    763:  { d:4, g:"Win 250 fights without any armor equipped. Remove all armor from your equipped items — you can still use weapons. You'll temporarily get the title 'Nudist'." },
    843:  { d:2, g:"On May 4th, defeat someone using ONLY fists (unequip all weapons). Attack a low-stat inactive and win. Only works on May 4th each year." },
    863:  { d:4, g:"Defeat someone you just revived. Revive a player from hospital, then immediately attack and beat them. Coordinate with a willing player who agrees to lose." },
    870:  { d:4, g:"Revive someone you just defeated. After winning an attack and hospitalizing someone, immediately use a revive on them. Requires revive capability (education)." },
    846:  { d:4, g:"Defeat 100 players while physically abroad (at a destination, not in transit). Stack energy before flying, then attack inactives at your destination country." },
    916:  { d:5, g:"Save a chain of 100+ hits by attacking within the last 10 seconds before the timer expires. Requires your faction to deliberately let the chain timer run near-zero — risks the entire chain. Only feasible with full faction coordination." },
    1001: { d:4, g:"Deal over 10,000,000 total damage across all attacks. Can be rushed by attacking NPCs (Duke, Leslie, Jimmy) at loot events." },
    1002: { d:4, g:"Deal over 1,000,000 total damage. Should come within weeks or months of active attacking." },
    1003: { d:5, g:"Deal over 100,000,000 total damage. Very long-term — requires sustained heavy attacking over many months." },
    1004: { d:1, g:"Deal over 100,000 total damage. Should trigger within a few days of active attacking for most players." },

    234:  { d:4, g:"Own all middleweight gym memberships. Join a 3 stars music store to gain gym exp quickly." },
    235:  { d:4, g:"Own all heavyweight gym memberships. Join a 3 stars music store to gain gym exp quickly." },
    240:  { d:4, g:"Gain 1,000,000 Defense. Train Defense daily at the gym. Takes consistent training over months." },
    241:  { d:4, g:"Gain 1,000,000 Dexterity. Train Dexterity daily." },
    242:  { d:4, g:"Gain 1,000,000 Speed. Train Speed daily." },
    243:  { d:4, g:"Gain 1,000,000 Strength. Train Strength daily." },
    497:  { d:4, g:"Gain 10,000,000 Defense. Long-term gym training — gym memberships and a director who trains you significantly accelerate this." },
    498:  { d:4, g:"Gain 1,000,000,000 Defense. Very long-term — requires years of consistent training." },
    505:  { d:4, g:"Gain 10,000,000 Speed. Long-term gym training." },
    506:  { d:4, g:"Gain 100,000,000 Speed. Long-term gym training." },
    550:  { d:4, g:"Gain 1,000,000,000 Speed. Extremely long-term goal." },
    629:  { d:4, g:"Gain 100,000,000 Dexterity. Long-term gym training." },
    635:  { d:4, g:"Gain 10,000,000 Dexterity. Long-term gym training." },
    638:  { d:4, g:"Gain 1,000,000,000 Dexterity. Very long-term goal." },
    640:  { d:4, g:"Gain 100,000,000 Defense. Long-term gym training." },
    643:  { d:4, g:"Gain 10,000,000 Strength. Long-term gym training." },
    646:  { d:4, g:"Gain 100,000,000 Strength. Long-term gym training." },
    647:  { d:4, g:"Gain 1,000,000,000 Strength. Very long-term goal." },
    679:  { d:4, g:"Attain 100,000,000 total stats. Long-term consistent training across all four stats." },
    694:  { d:4, g:"Attain 1,000,000 total stats. Several weeks to months of consistent gym training." },
    708:  { d:4, g:"Attain 10,000,000 total stats. Months of dedicated gym training." },
    721:  { d:4, g:"Attain 1,000,000,000 total stats. Very long-term — requires years of training." },
    723:  { d:4, g:"Attain 100,000 total stats. A few weeks of consistent training." },
    690:  { d:4, g:"Attain 10,000,000,000 total stats. Reserved for veteran players — extremely long-term." },
    704:  { d:4, g:"Attain 100,000,000,000 total stats. One of the rarest gym milestones in the game." },
    888:  { d:5, g:"Have the numbers 69 and 420 appear 5 times total across your four battle stats (at least one of each). Example: Str=420,123 / Spd=52,069 / Dex=345,420 / Def=42,069. Use a Torn stat calculator to track — requires precise stat management near each milestone." },

    525:  { d:4, g:"Attain 100,000 Endurance. Work at a company with Endurance training and ask your director to train you. Takes many months of daily training." },
    530:  { d:4, g:"Attain 100,000 Intelligence. Same approach as Tireless but for Intelligence stat." },
    533:  { d:4, g:"Attain 100,000 Manual Labor. Requires a company that offers Manual Labor training." },

    53:   { d:4, g:"Complete all courses in the Biology degree. Focus your education queue on Biology. Each Bachelor takes ~200 days with education reduction merits." },
    54:   { d:4, g:"Complete all courses in the Business degree. Queue Business courses and keep one running at all times." },
    55:   { d:4, g:"Complete all courses in the Combat degree." },
    56:   { d:4, g:"Complete all courses in the ICT degree. Also unlocks the online Bootlegging store as a side benefit." },
    57:   { d:4, g:"Complete all courses in the Defense degree." },
    58:   { d:4, g:"Complete all courses in General Studies." },
    59:   { d:4, g:"Complete all courses in Health & Fitness." },
    60:   { d:4, g:"Complete all courses in History." },
    61:   { d:4, g:"Complete all courses in Law. Strongly recommended — gives +50% jail bust success." },
    62:   { d:4, g:"Complete all courses in Mathematics." },
    63:   { d:4, g:"Complete all courses in Psychology. Gives +10% crime success — very valuable." },
    64:   { d:4, g:"Complete all courses in Sports Science." },

    30:   { d:4, g:"Use 50 Ecstasy total. Gives a happiness boost. Buy from item market. ~24-hour drug cooldown." },
    31:   { d:4, g:"Use 50 Ketamine total. Reduces enemy stats in combat. Buy from item market. Drug cooldown applies." },
    32:   { d:4, g:"Use 50 LSD total. Gives +35% to all battle stats — very useful before important fights. Buy from item market." },
    33:   { d:4, g:"Use 50 Opium total. Gives energy and nerve boost. Buy from item market. Drug cooldown applies." },
    34:   { d:4, g:"Use 50 Shrooms total. Gives a happiness boost. Buy from item market." },
    35:   { d:4, g:"Use 50 Speed total. Gives +35% to Speed stat. Drug cooldown applies." },
    36:   { d:4, g:"Use 50 PCP total. Gives a stat boost. Drug cooldown applies." },
    37:   { d:4, g:"Use 50 Xanax total. Gives +250 energy — use before big chains or attacks. Already the most useful drug in the game. Buy from item market or faction stock." },
    38:   { d:4, g:"Use 50 Vicodin total. Restores life points. Buy from item market. Drug cooldown applies." },

    50:   { d:4, g:"Achieve 50 Hunting skill. World Tiger Day (August 29th) gives 500% bonus hunting XP — stack 1,000 energy and hunt all day on that date. Hunting any other time wastes energy." },
    51:   { d:4, g:"Achieve 75 Hunting skill. Same approach as Zebra Skin — maximize World Tiger Day trips each year." },
    52:   { d:5, g:"Achieve 100 Hunting skill (maximum). Requires multiple World Tiger Day events worth of grinding." },

    130:  { d:4, g:"Travel to Argentina 50 times. Combine with importing items each trip for efficiency. Use a Large Suitcase." },
    131:  { d:4, g:"Travel to Mexico 50 times. Short flight — one of the easier destination honors. Always import items." },
    132:  { d:4, g:"Travel to UAE 50 times. Longest flight — only prioritize if combining with heavy item importing as it drains energy fast." },
    133:  { d:4, g:"Travel to Hawaii 50 times. Medium flight. Always bring a suitcase for imports." },
    134:  { d:4, g:"Travel to Japan 50 times. Long flight — only worth it if combining with item importing." },
    135:  { d:4, g:"Travel to UK 50 times. Medium flight. Combine with imports." },
    136:  { d:4, g:"Travel to South Africa 50 times. Long flight — combine with heavy importing." },
    137:  { d:4, g:"Travel to Switzerland 50 times. Medium flight. Combine with imports." },
    138:  { d:4, g:"Travel to China 50 times. Long flight — combine with heavy importing." },
    139:  { d:4, g:"Travel to Canada 50 times. Short flight — one of the easier travel honors." },
    272:  { d:4, g:"Travel to Cayman Islands 50 times. Short flight — combine with item imports each trip." },
    543:  { d:4, g:"Import 10,000 items from abroad total. Very long-term — always use a Large Suitcase on every flight. Stacks across all trips." },
    567:  { d:4, g:"Spend 31 cumulative days in the air (flight time only — time spent at destination doesn't count)." },
    557:  { d:4, g:"Spend 365 cumulative days in the air. Extremely long-term — achievable only after years of heavy traveling." },
    853:  { d:3, g:"Purchase the 'perfect souvenir' abroad. Which item depends on the last 2 digits of your Torn ID — check the Torn forum souvenir guide for your specific item, then travel to that country and buy it." },

    269:  { d:4, g:"Spin the roulette wheel 1,000 times. At ~75 spins per day it takes about 14 days. Open multiple tabs to speed it up." },
    327:  { d:4, g:"Win 50 games of Russian Roulette in the Casino. Play at minimum bet ($1) — you win roughly 1 in 6 games, so expect ~300 games total." },
    275:  { d:5, g:"Win the jackpot on the slot machine. Pure RNG — no known strategy to increase odds. Just keep playing slots over time." },
    276:  { d:5, g:"Win one of the Torn City lotteries. Buy tickets regularly from the City and wait." },

    3:    { d:3, g:"Invest $100,000,000 in the stock market. Buy any stock totaling $100M+ and hold or sell for profit." },
    8:    { d:4, g:"Achieve a high credit score with Duke (City → Duke → Loan). Take a loan and pay it back when requested. A $160k loan works — somewhat random and may take a few months." },
    9:    { d:3, g:"Own a Private Island with an Airstrip upgrade. You need to own it, not rent it. You can ask a rich friend to give you one, own it for two mintues and then give it back." },
    10:   { d:3, g:"Make a $1,000,000,000 city bank investment. Save up $1B and deposit it for any duration (minimum 1 week)." },
    544:  { d:3, g:"Make a $10,000,000 profit in a single stock market sale. Invest in a stock and wait until you're up $10M, then sell. More invested = faster." },
    548:  { d:3, g:"Make a $100,000,000 profit in a single stock sale. Requires large stock holdings or significant patience." },
    545:  { d:5, g:"Make a $1,000,000,000 profit in a single stock sale. Requires enormous investment — end-game wealth goal." },
    546:  { d:4, g:"Receive 100 stock payouts. Dividends are paid weekly (Tuesdays). Hold any dividend-paying stock for ~2 years." },
    523:  { d:3, g:"Donate $100,000,000 cumulative to the Church (City → Church → Donate). Stacks over time — doesn't need to be all at once." },
    522:  { d:5, g:"Donate $1,000,000,000 cumulative to the Church. Enormous total cost — very long-term." },
    273:  { d:3, g:"Win 10 auctions. Bid a fixed amount (e.g. $250k) on many cheap auctions until 10 are won. Sell the items back to break even." },
    258:  { d:3, g:"Own a yacht. Buy a property with a Yacht upgrade, or ask a friend who has one to loan/lease it for 2 minutes to trigger the honor." },
    869:  { d:5, g:"Own every stock benefit AND dividend simultaneously. Requires massive investment across all available stocks at once — extreme end-game goal." },
    1005: { d:4, g:"Achieve $1,000,000,000 in cumulative stock market profits. Long-term investing milestone." },
    1006: { d:4, g:"Achieve $1,000,000,000 in cumulative stock market losses. Comes from aggressive trading over time." },
    1007: { d:3, g:"Lose $100,000,000 in a single stock sale. Invest in a stock and deliberately sell at a $100M loss." },

    7:    { d:4, g:"Use 5,000 medical items total. Use blood bags, first aid kits, and other medicals in combat regularly. Very long-term grind." },
    23:   { d:4, g:"Revive 500 players total. Requires revive skill (education). Revive actively whenever possible." },
    267:  { d:4, g:"Revive 1,000 players total. Same as Florence Nightingale — keep reviving consistently. Very long-term." },
    322:  { d:5, g:"Revive 10 different players within 10 minutes. Requires revive skill and a very active hospital. Best during major wars when many players are hospitalized simultaneously — coordinate with faction." },
    398:  { d:4, g:"Fill 1,000 empty blood bags. Complete Intro to Biochemistry + Intravenous Therapy education first. Always keep a medical cooldown active by filling bags daily." },
    406:  { d:4, g:"Random chance when using (not filling) a blood bag. Just keep using blood bags for healing and it will eventually trigger." },
    418:  { d:4, g:"Fill 250 empty blood bags. Complete Intravenous Therapy education. Fill bags as part of your daily routine." },

    1:    { d:4, g:"Find 50 items in the City (City → Look Around). Items spawn randomly — use the Torntools browser extension to help locate them faster." },
    4:    { d:4, g:"Use 100 job points. Works at both player-owned companies and city jobs (companies give more points per day). Minimum ~10 days." },
    164:  { d:4, g:"Use 1,000 job points. Takes a minimum of 100 days of consistent working." },
    238:  { d:4, g:"Find 1,000 items in the City Dump (Crimes → Search for Cash → Dump). Costs 5 energy per search — 5,000 energy total. Do passively during daily crime activities." },
    527:  { d:3, g:"Use a Stat Enhancer item. The four Stat Enhancers are: Boxing Gloves, Skateboard, Parachute, and Dumbbells — sold at Nikeh Sports city shop for ~$450M each. NOTE: Snowboard is NOT an enhancer — don't get scammed." },
    538:  { d:4, g:"Drink 500 cans of energy drink total. Buy in bulk from item market. Limited by booster cooldown — ~24 per day max." },
    539:  { d:4, g:"Read 10 books. Books come from mission rewards and faction subscription rewards — use them from inventory when received." },
    699:  { d:3, g:"Maintain an impressive display case. Fill it with 5+ rare collectible items and keep them there for 30 days. Check Torn wiki for which items qualify as collectibles." },
    882:  { d:3, g:"Use a Neumune Tablet to reduce radiation poisoning. First get irradiated: use a Blood Bag: Irradiated (item market, ~$2-3M). Then use a Neumune Tablet. You must be actively irradiated before the tablet works." },

    229:  { d:4, g:"Achieve 250 total awards (honors + medals combined). Comes naturally from active playing and collecting honors over time." },
    244:  { d:4, g:"Achieve 100 personal perks. Perks come from education courses, faction perks, stock benefits, crime enhancers, and merits. Check your profile → Perks section." },
    245:  { d:4, g:"Achieve 1,000 hours of activity on Torn. Accumulates passively just from logging in and playing regularly." },
    216:  { d:4, g:"Code 100 computer viruses (Crimes → Computer Crimes). Each attempt uses nerve. Just keep coding viruses as part of regular crime activities." },
    259:  { d:4, g:"Reach level 50. Comes naturally from regular play — gain XP from attacking, missions, and activities." },
    264:  { d:4, g:"Reach level 100. Long-term level goal. Gain XP from attacking high-stat players and completing missions." },
    265:  { d:4, g:"Reach level 100. You earn both this and The Whole Nine Yards simultaneously upon hitting level 100." },
    266:  { d:3, g:"Refill your energy bar 250 times using points. Each refill costs 30 points (7,500 total). Only do this if you have excess points." },
    312:  { d:5, g:"Survive a Torn City server rollback. This is an extremely rare event that cannot be forced — just log in regularly and hope one happens." },
    334:  { d:3, g:"Refill your Casino tokens 250 times using points. Each refill costs 30 points (7,500 total). Only if you have spare points." },
    380:  { d:4, g:"Achieve 99,999 happiness (maximum). Gained from working — especially a Toy Shop which gives massive boosts. Keep working and using happiness items." },
    566:  { d:3, g:"Refill your nerve bar 250 times using points. Each refill costs 30 points (7,500 total). Only if you have spare points." },
    571:  { d:4, g:"Win 100 races. Set up custom 1-lap Speedway races with a friend — about 20 races per hour. Or just race normally over time." },
    572:  { d:4, g:"Reach racing skill level 10. Comes naturally from regular racing participation." },
    607:  { d:4, g:"Achieve 50 personal perks. Perks from education, faction, stocks, crime enhancers, and merits all count." },
    614:  { d:4, g:"Achieve 500 total awards. Long-term milestone — keep collecting honors and medals." },
    620:  { d:4, g:"Achieve 150 personal perks. Long-term goal — requires extensive education, stock holdings, and merit investment." },
    700:  { d:5, g:"Achieve top 250 in one of the personal Hall of Fame leaderboards. Extremely competitive — requires being among the top Torn players in a specific stat category." },
    729:  { d:3, g:"Unlock a hairstyle from the Token Shop or Points Building. Earn competition tokens from seasonal events and spend them in the Token Shop." },
    730:  { d:3, g:"Unlock a backdrop from the Token Shop or Points Building. Earn competition tokens from seasonal events." },
    734:  { d:4, g:"Crash a car during a race. Random event that occurs occasionally while racing — just keep racing and it will happen eventually." },
    742:  { d:4, g:"Use 10,000 job points total. Takes a minimum of ~1,000 days of working. Work at a player-owned company for more points per day." },
    217:  { d:4, g:"Refer one friend to Torn who reaches level 10. Share your referral link from your profile. Help them get started to ensure they stick around." },
    218:  { d:4, g:"Refer two friends to Torn who both reach level 10." },
    219:  { d:4, g:"Refer three friends to Torn who all reach level 10." },
    246:  { d:5, g:"Have one of your referrals go on to refer another player who reaches level 10. Cannot be forced — requires luck and patience." },
    839:  { d:5, g:"This is a secret honor — the unlock condition has never been officially confirmed. Just keep playing normally." },

    248:  { d:4, g:"Bust 1,000 players from jail total. Bust people from the Jail page regularly. Get your Law Bachelor first for +50% success rate." },
    249:  { d:4, g:"Bust 2,500 players from jail. Long-term jail busting — Law Bachelor is essential." },
    250:  { d:4, g:"Bust 10,000 players from jail. Very long-term — requires consistent daily busting for years." },
    252:  { d:4, g:"Make 500 bail payments from jail. Bail yourself or others out of jail 500 times total." },
    906:  { d:4, g:"Go to jail 250 times total. Comes naturally from failing crimes over time — don't stress about farming this specifically." },

    212:  { d:5, g:"Finish the Elimination competition with your team in 1st, 2nd, or 3rd place. Participate actively when Elimination runs and coordinate with teammates." },
    213:  { d:5, g:"Participate in the Mr & Ms Torn competition. An official Torn event — watch the announcements for when it runs." },
    214:  { d:5, g:"Complete the 4th stage of the TC Endurance challenge. Participate in the Endurance competition when it runs." },
    221:  { d:5, g:"Earn 50 or more Dog Tags in the Dog Tag competition. Stack 1,000 energy before the event, prepare a list of inactive targets, and hit them continuously." },
    222:  { d:4, g:"Find and collect 10 Easter eggs during the Easter seasonal event. Log in during Easter and click the egg hunt button — 10 eggs are easily found in one session." },
    224:  { d:5, g:"Complete the 5th stage of the TC Endurance challenge." },
    225:  { d:5, g:"Complete the bonus task of the TC Endurance challenge." },
    226:  { d:4, g:"Achieve 50 attacks against enemy team members in the Elimination competition. Participate actively when Elimination runs." },
    263:  { d:5, g:"Finish Torn of the Dead as a surviving civilian (not infected). Avoid getting infected throughout the event — requires luck and active avoidance of zombie players." },
    277:  { d:5, g:"Earn 250+ Dog Tags in the Dog Tag competition. Far more intensive than KIA — very competitive." },
    279:  { d:5, g:"Finish the Elimination competition with your team in 1st place. Very competitive." },
    280:  { d:5, g:"Finish the Elimination competition within the top 5% of attackers on your team." },
    306:  { d:4, g:"Attack 50 zombies in the Torn of the Dead event. Participate when it runs and attack infected players." },
    311:  { d:4, g:"Infect 50 civilians in the Torn of the Dead event. Become a zombie and attack uninfected players." },
    964:  { d:4, g:"Upgrade your Halloween Basket to 'Terrifying' during Halloween. Buy a basket when the event starts and attack players to fill it. Requires heavy Xanax use — may take two Halloween events at normal pace." },
    966:  { d:5, g:"Upgrade your Halloween Basket to 'Nightmarish'. Higher tier than Terrifying — requires extremely active participation." },
    969:  { d:4, g:"Upgrade your Halloween Basket to 'Frightful' (first tier). Achievable within 3 days of the event with consistent attacking." },

    328:  { d:5, g:"Steal a Cluster Ring from the Jewelry Store in Shoplifting. Requires high Shoplifting skill to access the Jewelry Store. The Cluster Ring is a rare steal — keep targeting the Jewelry Store." },
    676:  { d:4, g:"Successfully burgle all 34 Burglary areas. The final 3 unlock at level 100 (one per district). Work through all areas systematically — each only needs to be burglarized once, some of the locations will be unlocked once you reach level 100. Use torn.report to see what you bugalized already, and check the Wiki for Burglary to see what you're still missing." },
    1012: { d:4, g:"Find all 7 rotten food and drink items from the City Dump. Requires Trash skill level 45 to unlock all 7 items. Keep searching the Dump regularly." },
    1025: { d:4, g:"Achieve skill level 100 in Bootlegging. Just keep creating DVDs — you don't need to manually sell them for XP." },
    1028: { d:4, g:"Sell 10,000 DVDs of each movie genre in Bootlegging. Complete ICT Computer Science education to unlock your online store. Set it up and let it run for ~2 weeks." },
    1029: { d:4, g:"Achieve skill level 100 in Shoplifting. Grind daily across all Shoplifting areas. Slightly time-gated at first due to notoriety mechanics." },
    1031: { d:4, g:"Acquire 10,000 customers on your Bootlegging online DVD store. Unlock via ICT Computer Science education, set up the store, and leave it running ~2 weeks." },
    1032: { d:4, g:"Become initiated into one of Torn's 5 Graffiti crews. Reach Graffiti skill 70 and 500 reputation with the East Side crew, then complete the Unique crime at East Side." },
    1034: { d:4, g:"Achieve skill level 100 in Graffiti. Grind Graffiti crimes daily across all 7 locations." },
    1038: { d:4, g:"Achieve 100% notoriety at all Shoplifting stores simultaneously. Best done EARLY before your skill is too high. Have 200+ nerve available, then spam all areas until each hits 100%." },
    1053: { d:4, g:"Achieve skill level 100 in Card Skimming. Place 20 skimmers at Bus Station and leave for 2-3 weeks at a time. Very low nerve cost per XP — set and forget." },
    1064: { d:4, g:"Achieve skill level 100 in Burglary. Grind daily. Residential areas generally give better XP. Always case to maximum to avoid critical failures." },
    1076: { d:5, g:"Pickpocket a police officer's badge. Officers appear as 'running' targets and are rare. Very high critical fail chance — attempt at skill level 0 (no skill to lose) or wait until level 100." },
    1078: { d:4, g:"Achieve skill level 100 in Pickpocketing. Follow a Pickpocketing guide for safe target selection — avoid running targets to prevent critical fails." },
    1083: { d:4, g:"Achieve skill level 100 in Hustling. Follow the Hustling compact guide for the most efficient method." },
    1097: { d:4, g:"Achieve maximum technique in all 4 Hustling confidence tricks. Use each trick type repeatedly until each maxes out." },
    1104: { d:4, g:"Achieve skill level 100 in Disposal. Use a disposal guide/table to pick safest jobs with best XP per nerve. Daily tasks respawn at midnight TCT." },
    1106: { d:4, g:"Dissolve a Dead Body in Acid (Crimes → Disposal). Dead Body jobs appear around skill level 85 and spawn 1-2 times per week. Keep grinding Disposal skill." },
    1118: { d:5, g:"Achieve skill level 100 in Cracking. Brute-force to identify characters, then guess when you have enough info. A Cracking helper script significantly speeds this up. Build an efficient rig using MIPS optimization guides." },
    1129: { d:4, g:"Successfully guess 250 password characters in Cracking. Use a Cracking guessing tool to accelerate identification. Comes naturally while grinding toward level 100." },
    1130: { d:5, g:"Achieve skill level 100 in Forgery. Driver's License forgery is most accessible — materials for higher-tier forgeries can be very expensive." },
    1136: { d:4, g:"Have 10 of the same Forgery project in cooldown simultaneously. License Plates have a 1-hour cooldown. Requires at least 25 Forgery skill — create 10 License Plates at once." },
    1166: { d:5, g:"In a single successful scam, respond to all four of your target's prompt types: Temptation (blue arrow), Sensitivity (red arrow), Concern (yellow tile), and Hesitation (purple tile). Learn the Scamming tile navigation system." },
    1218: { d:4, g:"Earn $1,000,000 from a single scam. Target high-value marks and navigate tiles carefully to maximize payout." },
    1229: { d:4, g:"Sell at least 10,000 card details at once in Card Skimming. With 20 skimmers running, accumulating 10,000 takes several weeks." },
    1241: { d:4, g:"Run a Cracking rig at 2,500,000 MIPS. Build an optimized rig using a Cracking rig-building guide for best component selection." },
    1243: { d:4, g:"Create a passport in Forgery. Passports unlock at higher Forgery skill — gather required materials from the market and forge one." },
    1271: { d:4, g:"Achieve 5/5 reputation in all 7 Graffiti locations simultaneously. Tag consistently across all locations — your rep decays if you neglect any one location." },
    1277: { d:4, g:"Achieve skill level 100 in Scamming. Follow a Scamming guide to learn efficient tile navigation." },
    1284: { d:4, g:"Win $100,000 from a single bet in Hustling. Target high-value marks and use optimal technique." },
    1328: { d:4, g:"In Pickpocketing, steal exclusively from 'skinny' (running) targets for enough successes. Follow the Pickpocketing safe target guide." },
    1360: { d:4, g:"Clear ALL available Disposal jobs in a single day. Complete every job before midnight TCT when they respawn." },
    1371: { d:5, g:"Destroy the largest building size in Arson in under 30 seconds. Requires high Arson skill and the optimal ignitor/accelerant combination — check an Arson combo guide." },
    1374: { d:4, g:"Achieve skill level 100 in Arson. Warehouse Arson (11 nerve, ~95% success) is the most nerve-efficient method. Grind daily." },
    1387: { d:4, g:"Use all 15 Arson ignitors, accelerants, and dampeners at least once each. These unlock progressively as Arson skill increases — just keep grinding." },

    896:  { d:2, g:"Defeat any co-worker from your current company. Find the weakest player in your company's employee list and attack them." },
    605:  { d:2, g:"Defeat a fellow faction member. Coordinate with a willing, weaker factionmate — they agree to let you win." },
    860:  { d:2, g:"Buy a Trailer from Properties (~$1.5M from the city), go to Properties → Trailer → Rent Out, set rent to $0, then ask anyone to rent it. Post in a Torn chat if needed." },
    739:  { d:2, g:"Get mugged for exactly $1. You need to carry exactly $10 in cash (the mug gives ~10% of what you hold, so $10 → $1 mugged). Have a trusted friend mug you while you hold $10. Put everything else in the bank first." },
    317:  { d:2, g:"Be defeated by someone, then defeat them within 10 minutes. Coordinate with a friend: they beat you first, you immediately med out and counter-attack. You may need to hospitalize them to win." },
    519:  { d:2, g:"Beat 10 different unique opponents in Russian Roulette. Set $10 minimum bets in the Casino — lots of players join low-stake games. You need 10 different people defeated, not just 10 wins." },
    827:  { d:2, g:"You and your spouse must both participate in the same attack. One of you starts the attack, the other clicks Assist. Pick a weak inactive target. Both need to be online at the same time." },
    955:  { d:2, g:"Mug someone who has just mugged someone else. Have a friend mug any player, then you immediately mug your friend right after their mug resolves." },
    615:  { d:2, g:"Defeat someone while they are mid-attack on another player. Have a friend start an attack on someone but not finish it — you then attack and defeat your friend before they finish that fight." },
    247:  { d:2, g:"Make $1,000,000 from a single mugging. Have a trusted friend hold $15M+ in cash (you steal ~10%), then mug them. Use a ghost trade immediately after to protect the cash. Or post in forums to buy a mug." },
    488:  { d:2, g:"Perform a faction retaliation. When someone attacks a factionmate, you hospitalize the attacker within ~5 minutes. You must be in the same faction as the attacked player." },
    871:  { d:4, g:"Get a finishing kill using only a Kick. First complete Introduction to Self-Defense → Kick-boxing in Education. Then equip no weapon and kill a low-level inactive using only Kick." },
    670:  { d:4, g:"Receive actual loot from a defeated NPC. You need to deal any damage during an NPC fight. Check yata.yt for schedules, make sure to hit when the blue distraction icon is there, so you don't get knocked out immediately. It's not a guaranteed drop and will require multiple times to get loot, it's luck." },
    481:  { d:2, g:"Defeat someone with higher total battle stats than you in a solo attack. Ask a stronger friend to fight you with their armor unequipped and a weak weapon — they intentionally let you win." },
    627:  { d:2, g:"Defeat someone with at least double your total stats. Ask a friend with 2× your stats to go fully naked (no armor, weak weapon) and deliberately lose. Penguinbob is a known community candidate for lower-stat players." },
    631:  { d:2, g:"Defeat someone with 5× your stats. Use stat boosters (Epinephrine, etc...). Ask the target to strip all armor and use only a weak weapon. For lower-stat players, penguinbob is commonly recommended." },
    719:  { d:2, g:"Win a defense against someone who has double your stats. Coordinate with a stronger friend: they attack you while naked with a weak weapon, intentionally losing the attack." },
    500:  { d:2, g:"Win an attack while at 1% or less life. Drop your health with blood bags to very low, attack a weak target using a Pillow (no damage), and kill them before you die. Have med items ready to recover." },
    781:  { d:2, g:"Hit 10 different body parts in one attack and then win. Equip a Pillow (~$6k, no damage) to spread many hits around all body parts, then switch to your real weapon to finish. Pick a target that can survive a while." },
    828:  { d:2, g:"Defeat someone on exactly turn 25 (the final possible turn). Equip a Pillow (~$6k) and keep hitting until turn 24, then switch to your main weapon and finish on turn 25." },
    800:  { d:2, g:"Use 100 rounds of special ammo total. Buy special ammo from the Mission shop for credits, or steal some from Big Al's. Check your inventory under 'Ammo' to see what you have." },
    256:  { d:2, g:"Get a single chain hit worth 10+ faction respect. You need decent stats and a good chain target. Pop Xanax before the attack for a stat boost. Only triggers during an active faction chain." },
    15:   { d:2, g:"Achieve a kill streak of 10 consecutive wins with zero losses (including defends). Best attempted during new player protection (first 14 days). Stay out of forums/chat, close your bazaar, attack only low-stat inactives." },
    477:  { d:2, g:"Get a single chain hit worth 100+ faction respect. Requires high stats and a high-ranked enemy faction target during war. Ask your faction leader for the right target." },

    395:  { d:3, g:"Reach 1,000 energy. Start from 0 energy and take 4 Xanax in sequence (each gives +250 energy with a 6-8hr drug cooldown between uses). Each Xanax costs ~$850k — total ~$3.4M." },
    268:  { d:3, g:"Sell 1,000 points on the market total. Buy 25-50 points at a time and relist them. Repeat until you hit 1,000 total sold. You'll take a small loss per cycle but it's fast. Costs ~$100-200k net." },
    678:  { d:3, g:"Use Stink Bombs on a player weaker than you (if you target someone stronger, you get hospitalized). Buy Stink Bombs from Item Market → Specials (~$800k). Use from inventory → Use → enter a weaker player's name." },
    717:  { d:3, g:"Use Dog Poop on a weaker player. Buy from Item Market → Specials (~$800k). Same process as Stink Bombs — target must be weaker or you get hosp'd." },
    716:  { d:3, g:"Use Toilet Paper on a weaker player. Buy from Item Market → Specials (~$800k). Same process as the other prank items." },
    437:  { d:3, g:"Spin the Wheel of Mediocrity in the Casino ($50,000 per spin) and win at least once. Keep spinning until you win. Budget a few million for attempts." },
    427:  { d:3, g:"Spin the Wheel of Awesome in the Casino ($1,000,000 per spin) and win at least once. Budget several million for attempts — RNG." },
    431:  { d:3, g:"Spin the Wheel of Lame in the Casino ($1,000 per spin) and win at least once. Cheapest of the three wheels. Just keep spinning." },
    743:  { d:3, g:"Trash an item with a current market value of at least $1,000,000. Buy any item just over $1M in market value (e.g. a small suitcase), then dump it from your inventory." },
    233:  { d:3, g:"Own all lightweight gym memberships: Bucks Fitness, Frontline Fitness, City Gym, and Anabolic Supplements. Buy all four from their respective city locations." },
    239:  { d:3, g:"Have 100 different unique customers buy from your Bazaar. You need to buy a Bazaar (~250 points). Sell cheap popular items like Lollipops at low prices to attract buyers fast." },

    316:  { d:4, g:"Pray at the Church twice daily (with ~8-10hr gap between prayers) for 7-14 days straight without missing. If you skip a full prayer cycle, the timer resets to zero. Set phone reminders. City → Church → Pray." },
    534:  { d:4, g:"Drink 500 bottles of alcohol total. Limited by booster cooldown (~24 per day max). Budget ~21 days and ~$350k. Buy cheap beer in bulk from the Item Market." },
    537:  { d:4, g:"Eat 500 bags of candy total. Buy Lollipops cheaply from the City Shop. Eat as many per day as your booster cooldown allows." },
    29:   { d:4, g:"Use 50 Cannabis total. Each use triggers a ~1.5hr cooldown. Total time: up to 75 hours spread over days. Each Cannabis costs ~$6,000, so about $300k total." },
    541:  { d:4, g:"Import 100 items while returning from abroad. Use a Large Suitcase to bring back multiple items per trip. Stacks across all trips over time." },
    542:  { d:4, g:"Import 1,000 items from abroad total. Same as Mule but more. Keep bringing back suitcases full each trip." },
    549:  { d:4, g:"Spend 7 cumulative days in the air (travel time only — time spent at a destination doesn't count). Longer flights help. Stacks across all journeys." },
    873:  { d:4, g:"Log in every single day for 100 consecutive days without missing one. Set a daily alarm — missing even one day resets the counter." },
    1054: { d:4, g:"Go to Crimes → Card Skimming → Bus Station. Install a skimmer there and leave it for ~3 weeks to accumulate 250+ card details. Then recover it to trigger the honor." },
    163:  { d:4, g:"Stay married to the same person for 250 consecutive days. Get married via the Chapel (City) and don't divorce." },
    162:  { d:4, g:"Stay married to the same person for 750 consecutive days." },
    257:  { d:4, g:"Participate in a faction chain of at least 1,000 hits. Join during a major planned chain event — ask your faction leadership when the next big chain is." },
    475:  { d:4, g:"Participate in a faction chain of at least 10,000 hits. Requires a very active faction with regular large chains." },
    844:  { d:4, g:"Reach 10,000 in any one working stat (Manual Labor, Intelligence, or Endurance). Ask your company director to train you — directors can boost stats much faster than self-training." },
    11:   { d:4, g:"Travel abroad 100 times total. Stacks across all trips. Just keep traveling regularly." },
    165:  { d:4, g:"Travel abroad 1,000 times total. Long-term goal — just keep traveling consistently." },
    309:  { d:4, g:"Log in on December 25th (Christmas Day). Just be online — even briefly — that day." },
    731:  { d:4, g:"Log in on February 14th (Valentine's Day). Just be online that day." },
    443:  { d:4, g:"Log in on October 31st (Halloween). Just be online that day." },
    459:  { d:4, g:"Log in on November 15th (Torn's anniversary). Just be online that day." },
    375:  { d:4, g:"Log in on January 1st (New Year's Day). Just be online that day." },
    271:  { d:4, g:"Trash (dump) 5,000 items total. Buy the cheapest items in bulk from the market (flowers, lollipops, etc.) and dump them in batches." },
    903:  { d:4, g:"Go to hospital 250 times total (cumulative). Comes naturally over time — don't stress about farming this one." },
    651:  { d:4, g:"Complete 50 education courses total. Keep taking any courses in Education." },
    656:  { d:4, g:"Complete 100 education courses total." },
    552:  { d:4, g:"Participate in 100 organized crimes with your faction. Join your faction's organized crime runs regularly." },
    251:  { d:4, g:"Commit 10,000 criminal offenses total (Crimes v2 — any crime type counts toward this)." },
    617:  { d:4, g:"Max out any merit upgrade to its full 10/10. Requires 55 total merits spent — keep collecting merits and focus them into one upgrade to completion." },

    338:  { d:5, g:"Achieve all four Blackjack milestones in any order (separate sessions are fine): 1) Natural — 21 with only your first 2 cards. 2) Double Down — press the Double button on a strong starting hand. 3) Insurance — place the insurance side bet when the dealer shows an Ace. 4) Six Card Charlie — receive 6 cards without going over 21. Bet $10 minimum to minimize losses. Be patient." },
    326:  { d:5, g:"Get a win streak of 25 consecutive rounds in High-Low (Casino). Bet the minimum each time. Any loss resets the streak. Pure RNG — just keep playing consistently." },
    220:  { d:5, g:"Irritate ALL job interviewers simultaneously. You must have minimum stats to qualify for all starter jobs. Each interviewer has a specific way to annoy them — check the dedicated guide thread on Torn forums (search 'Affronted guide'). You must fail every interview in the same session." },
    22:   { d:5, g:"Win 50 defends (people must attack you and lose). Post in the Attacking Forum offering ~$250k per bought loss. Pay each person immediately after they lose to avoid bounties and hate mail. Delete your post when done. Total cost ~$12-15M." },
    16:   { d:5, g:"Achieve a kill streak of 100 consecutive wins with absolutely zero losses (attacking or defending). Best attempted during new player protection. Avoid ALL forums and chat. Keep bazaar closed. Use stealth. Target 60+ attacks per day. Buy defends if necessary to avoid random attackers." },
    478:  { d:5, g:"Get a single chain hit worth 1,000+ faction respect. Requires elite stats and an extremely high-ranked enemy faction target during war. Consult your faction's top fighters and leadership." },
    513:  { d:5, g:"Win $100M from a single Russian Roulette game. You and a trusted friend both bring $50M+, play password-protected games, and take turns winning. Move winnings to a ghost trade instantly — mugging snipers patrol the RR page." },
  };

  const HON_REFILL_COST = 30;
  const honRefillSub = (v, tg) => `≈ ${((tg - v) * HON_REFILL_COST).toLocaleString()} points to go (${HON_REFILL_COST} pts per refill)`;
  const honDays = (v, tg) => `${(v / 86400).toFixed(1)}d / ${(tg / 86400).toFixed(0)}d`;
  const honHours = (v, tg) => `${Math.floor(v / 3600).toLocaleString()}h / ${Math.floor(tg / 3600).toLocaleString()}h`;

  // Honor ID -> where its progress is in the personal stats (v2 user/personalstats?cat=all)
  const HON_PROGRESS = {
    39:   { path:'attacking.attacks.won',            target:5,          label:'Attacks won' },
    40:   { path:'attacking.attacks.won',            target:20,         label:'Attacks won' },
    41:   { path:'attacking.attacks.won',            target:50,         label:'Attacks won' },
    42:   { path:'attacking.attacks.won',            target:100,        label:'Attacks won' },
    43:   { path:'attacking.attacks.won',            target:250,        label:'Attacks won' },
    20:   { path:'attacking.hits.critical',          target:25,         label:'Critical hits' },
    270:  { path:'attacking.attacks.stalemate',      target:100,        label:'Stalemates' },
    490:  { path:'attacking.attacks.assist',         target:250,        label:'Assists' },
    639:  { path:'attacking.attacks.assist',         target:1,          label:'Assists' },
    254:  { path:'attacking.hits.one_hit_kills',     target:1,          label:'One-hit kills' },
    517:  { path:'attacking.hits.one_hit_kills',     target:100,        label:'One-hit kills' },
    601:  { path:'attacking.hits.success',           target:10000,      label:'Total hits' },
    1004: { path:'attacking.damage.total',           target:100000,     label:'Total damage dealt' },
    1002: { path:'attacking.damage.total',           target:1000000,    label:'Total damage dealt' },
    1001: { path:'attacking.damage.total',           target:10000000,   label:'Total damage dealt' },
    1003: { path:'attacking.damage.total',           target:100000000,  label:'Total damage dealt' },
    740:  { path:'attacking.damage.best',            target:5000,       label:'Best single hit' },
    741:  { path:'attacking.damage.best',            target:10000,      label:'Best single hit' },
    786:  { path:'attacking.damage.best',            target:15000,      label:'Best single hit' },
    15:   { path:'attacking.killstreak.current',     target:10,         label:'Current kill streak' },
    16:   { path:'attacking.killstreak.current',     target:100,        label:'Current kill streak' },
    22:   { path:'attacking.defends.won',            target:50,         label:'Defends won' },
    228:  [
            { path:'attacking.attacks.won',   target:1000, label:'Attacks won' },
            { path:'attacking.defends.total', target:1000, label:'Total defends' },
          ],
    763:  { path:'attacking.unarmored_wins',         target:250,        label:'Unarmored wins' },
    232:  { path:'bounties.collected.amount',        target:250,        label:'Bounties collected' },
    236:  { path:'bounties.collected.value',         target:10000000,   label:'Bounty earnings ($)' },
    140:  { path:'attacking.ammunition.total',       target:1000,       label:'Rounds fired' },
    151:  { path:'attacking.ammunition.total',       target:10000,      label:'Rounds fired' },
    834:  { path:'attacking.ammunition.total',       target:100000,     label:'Rounds fired' },
    836:  { path:'attacking.ammunition.total',       target:1000000,    label:'Rounds fired' },
    800:  { path:'attacking.ammunition.special',     target:100,        label:'Special ammo used' },
    793:  { path:'attacking.ammunition.special',     target:1000,       label:'Special ammo used' },
    791:  { path:'attacking.ammunition.special',     target:10000,      label:'Special ammo used' },
    942:  { path:'attacking.ammunition.hollow_point',target:2500,       label:'Hollow Point used' },
    943:  { path:'attacking.ammunition.piercing',    target:2500,       label:'Piercing ammo used' },
    944:  { path:'attacking.ammunition.incendiary',  target:2500,       label:'Incendiary ammo used' },
    945:  { path:'attacking.ammunition.tracer',      target:2500,       label:'Tracer ammo used' },
    141:  { path:'finishing_hits.heavy_artillery',   target:100,        label:'Heavy artillery kills' },
    144:  { path:'finishing_hits.machine_guns',      target:100,        label:'Machine gun kills' },
    146:  { path:'finishing_hits.rifles',            target:100,        label:'Rifle kills' },
    148:  { path:'finishing_hits.sub_machine_guns',  target:100,        label:'SMG kills' },
    147:  { path:'finishing_hits.shotguns',          target:100,        label:'Shotgun kills' },
    145:  { path:'finishing_hits.pistols',           target:100,        label:'Pistol kills' },
    143:  { path:'finishing_hits.temporary',         target:100,        label:'Temporary weapon kills' },
    149:  { path:'finishing_hits.piercing',          target:100,        label:'Piercing kills' },
    150:  { path:'finishing_hits.slashing',          target:100,        label:'Slashing kills' },
    142:  { path:'finishing_hits.clubbing',          target:100,        label:'Clubbing kills' },
    515:  { path:'finishing_hits.hand_to_hand',      target:100,        label:'Hand-to-hand kills' },
    1014: { path:'crimes.skills.search_for_cash',    target:100,        label:'Search for Cash skill' },
    1025: { path:'crimes.skills.bootlegging',        target:100,        label:'Bootlegging skill' },
    1029: { path:'crimes.skills.shoplifting',        target:100,        label:'Shoplifting skill' },
    1053: { path:'crimes.skills.card_skimming',      target:100,        label:'Card Skimming skill' },
    1064: { path:'crimes.skills.burglary',           target:100,        label:'Burglary skill' },
    1078: { path:'crimes.skills.pickpocketing',      target:100,        label:'Pickpocketing skill' },
    1083: { path:'crimes.skills.hustling',           target:100,        label:'Hustling skill' },
    1104: { path:'crimes.skills.disposal',           target:100,        label:'Disposal skill' },
    1118: { path:'crimes.skills.cracking',           target:100,        label:'Cracking skill' },
    1130: { path:'crimes.skills.forgery',            target:100,        label:'Forgery skill' },
    1277: { path:'crimes.skills.scamming',           target:100,        label:'Scamming skill' },
    1374: { path:'crimes.skills.arson',              target:100,        label:'Arson skill' },
    251:  { path:'crimes.offenses.total',            target:10000,      label:'Total crimes committed' },
    903:  { path:'hospital.times_hospitalized',      target:250,        label:'Times hospitalized' },
    7:    { path:'hospital.medical_items_used',      target:5000,       label:'Medical items used' },
    23:   { path:'hospital.reviving.revives',        target:500,        label:'Players revived' },
    267:  { path:'hospital.reviving.revives',        target:1000,       label:'Players revived' },
    418:  { path:'hospital.blood_withdrawn',         target:250,        label:'Blood bags filled' },
    398:  { path:'hospital.blood_withdrawn',         target:1000,       label:'Blood bags filled' },
    906:  { path:'jail.times_jailed',                target:250,        label:'Times jailed' },
    248:  { path:'jail.busts.success',               target:1000,       label:'Successful jail busts' },
    249:  { path:'jail.busts.success',               target:2500,       label:'Successful jail busts' },
    250:  { path:'jail.busts.success',               target:10000,      label:'Successful jail busts' },
    252:  { path:'jail.bails.amount',                target:500,        label:'Bail payments made' },
    29:   { path:'drugs.cannabis',  target:50, label:'Cannabis used' },
    30:   { path:'drugs.ecstasy',   target:50, label:'Ecstasy used' },
    31:   { path:'drugs.ketamine',  target:50, label:'Ketamine used' },
    32:   { path:'drugs.lsd',       target:50, label:'LSD used' },
    33:   { path:'drugs.opium',     target:50, label:'Opium used' },
    34:   { path:'drugs.shrooms',   target:50, label:'Shrooms used' },
    35:   { path:'drugs.speed',     target:50, label:'Speed used' },
    36:   { path:'drugs.pcp',       target:50, label:'PCP used' },
    37:   { path:'drugs.xanax',     target:50, label:'Xanax used' },
    38:   { path:'drugs.vicodin',   target:50, label:'Vicodin used' },
    11:   { path:'travel.total',    target:100,  label:'Trips abroad' },
    165:  { path:'travel.total',    target:1000, label:'Trips abroad' },
    130:  { path:'travel.argentina',          target:50, label:'Argentina trips' },
    131:  { path:'travel.mexico',             target:50, label:'Mexico trips' },
    132:  { path:'travel.united_arab_emirates',target:50,label:'UAE trips' },
    133:  { path:'travel.hawaii',             target:50, label:'Hawaii trips' },
    134:  { path:'travel.japan',              target:50, label:'Japan trips' },
    135:  { path:'travel.united_kingdom',     target:50, label:'UK trips' },
    136:  { path:'travel.south_africa',       target:50, label:'South Africa trips' },
    137:  { path:'travel.switzerland',        target:50, label:'Switzerland trips' },
    138:  { path:'travel.china',              target:50, label:'China trips' },
    139:  { path:'travel.canada',             target:50, label:'Canada trips' },
    272:  { path:'travel.cayman_islands',     target:50, label:'Cayman Islands trips' },
    549:  { path:'travel.time_spent', target:604800,    label:'Air time', fmt:honDays },
    567:  { path:'travel.time_spent', target:2678400,   label:'Air time', fmt:honDays },
    557:  { path:'travel.time_spent', target:31536000,  label:'Air time', fmt:honDays },
    541:  { path:'travel.items_bought', target:100,    label:'Items imported' },
    542:  { path:'travel.items_bought', target:1000,   label:'Items imported' },
    543:  { path:'travel.items_bought', target:10000,  label:'Items imported' },
    50:   { path:'travel.hunting.skill', target:50,    label:'Hunting skill' },
    51:   { path:'travel.hunting.skill', target:75,    label:'Hunting skill' },
    52:   { path:'travel.hunting.skill', target:100,   label:'Hunting skill' },
    4:    { path:'jobs.job_points_used', target:100,   label:'Job points used' },
    164:  { path:'jobs.job_points_used', target:1000,  label:'Job points used' },
    742:  { path:'jobs.job_points_used', target:10000, label:'Job points used' },
    571:  { path:'racing.races.won', target:100, label:'Races won' },
    572:  { path:'racing.skill',     target:10,  label:'Racing skill' },
    245:  { path:'other.activity.time', target:3600000, label:'Activity time', fmt:honHours },
    606:  { path:'other.awards', target:100,  label:'Total awards' },
    229:  { path:'other.awards', target:250,  label:'Total awards' },
    614:  { path:'other.awards', target:500,  label:'Total awards' },
    873:  { path:'other.activity.streak.current', target:100, label:'Daily login streak' },
    1:    { path:'items.found.city',          target:50,   label:'City items found' },
    238:  { path:'items.found.dump',          target:1000, label:'Dump items found' },
    271:  { path:'items.trashed',             target:5000, label:'Items trashed' },
    539:  { path:'items.used.books',          target:10,   label:'Books read' },
    537:  { path:'items.used.candy',          target:500,  label:'Candy eaten' },
    534:  { path:'items.used.alcohol',        target:500,  label:'Alcohol drunk' },
    538:  { path:'items.used.energy_drinks',  target:500,  label:'Energy drinks used' },
    527:  { path:'items.used.stat_enhancers', target:1,    label:'Stat enhancers used' },
    268:  { path:'trading.points.sold',       target:1000, label:'Points sold' },
    239:  { path:'trading.bazaar.customers',  target:100,  label:'Bazaar customers' },
    266:  { path:'other.refills.energy', target:250, label:'Energy refills', sub:honRefillSub },
    566:  { path:'other.refills.nerve',  target:250, label:'Nerve refills',  sub:honRefillSub },
    334:  { path:'other.refills.token',  target:250, label:'Casino token refills', sub:honRefillSub },
    216:  { path:'items.viruses_coded',               target:100, label:'Viruses coded' },
    546:  { path:'investments.stocks.payouts',        target:100, label:'Stock payouts' },
    273:  { path:'trading.items.auctions.won',        target:10,  label:'Auctions won' },
    222:  { path:'items.found.easter_eggs',           target:10,  label:'Easter eggs found' },
    552:  { path:'crimes.offenses.organized_crimes',  target:100, label:'Organized crimes' },
  };

  // Honor categories (type.id from the API); names come from I18N (honCats)
  const HON_CAT_ICON = {
    0: '⚙️', 1: '🏳️', 2: '🔫', 3: '🎖️', 4: '🎓', 5: '🔪', 6: '💊', 7: '✈️', 8: '⚔️', 9: '🎲',
    10: '💪', 11: '❤️', 12: '📈', 13: '🏆', 14: '💰', 15: '🔒', 16: '🎒', 17: '📋', 18: '🏥',
  };
  const HON_RARITY_RANK = {
    'Very Common': 1, 'Common': 2, 'Uncommon': 3, 'Limited': 4, 'Rare': 5, 'Very Rare': 6, 'Extremely Rare': 7,
  };
  const HON_RARITY_COLOR = {
    'Very Common': '#9ca3af', 'Common': '#9ca3af', 'Uncommon': '#60a5fa', 'Limited': '#c084fc',
    'Rare': '#fb923c', 'Very Rare': '#f87171', 'Extremely Rare': '#fbbf24',
  };

  // ---- Honor tracker: second tab ------------------------------------------------------------
  // var on purpose: renderHonors() may be called (and must return early) before this section ran
  var honReady = false; // eslint-disable-line no-var
  // Data only from api.torn.com (same key as the watchlist), images from www.torn.com.
  const HON_REFRESH_MS = 5 * 60 * 1000;  // own honors + personal stats: at most every 5 min, only while the tab is open
  const HON_ALL_MS = 24 * 3600 * 1000;   // the list of all honors rarely changes
  let honLoading = false;
  const hon = { tier: 0, cat: -1, search: '', sort: 'diff', showEarned: false, showHidden: false, open: new Set() };
  const honMode = () => { const m = GM_getValue('honMode', 'easy'); return m === 'cat' || m === 'all' ? m : 'easy'; };
  const honTier = (id) => (HON_DB[id] ? HON_DB[id].d : 6);
  const honStat = (stats, path) => {
    let cur = stats;
    for (const p of path.split('.')) {
      if (cur == null || typeof cur !== 'object') return null;
      cur = cur[p];
    }
    return typeof cur === 'number' ? cur : null;
  };
  const honNum = (n) => n.toLocaleString(getLang() === 'en' ? 'en-US' : 'de-DE');

  async function refreshHonors(force) {
    const key = getKey();
    if (!key || honLoading) return;
    if (!force && (isPaused() || Date.now() - GM_getValue('honorsAt', 0) < HON_REFRESH_MS)) return;
    honLoading = true;
    renderHonors();
    const check = (d) => {
      if (d && d.error) {
        throw new Error(d.error.code === 16 ? t('honAccess') : `${d.error.error || 'API error'} (Code ${d.error.code})`);
      }
      return d || {};
    };
    try {
      if (force || !GM_getValue('honorsAll', []).length || Date.now() - GM_getValue('honorsAllAt', 0) > HON_ALL_MS) {
        const d = check(await apiGet('v2/torn/honors?limit=1000', key));
        const all = (d.honors || [])
          .filter((h) => h && h.id && !(h.type && h.type.id === 1) && h.description !== 'A default honor bar available to everyone')
          .map((h) => ({ id: h.id, name: h.name || '', desc: h.description || '', cat: h.type ? h.type.id : 0, rarity: h.rarity || '' }));
        GM_setValue('honorsAll', all);
        GM_setValue('honorsAllAt', Date.now());
        await sleep(REQUEST_GAP_MS);
      }
      const u = check(await apiGet('v2/user/honors', key));
      const mine = (u.honors || []).map((h) => h.id);
      GM_setValue('honorsMine', mine);
      // Own ✓ marks: a manual sync (Sync / ⟳) resets them to Torn's real state; the automatic
      // refresh only drops marks that Torn now confirms anyway
      const mineSet = new Set(mine);
      const marks = GM_getValue('honorsDone', []);
      const keep = force ? [] : marks.filter((id) => !mineSet.has(id));
      if (keep.length !== marks.length) GM_setValue('honorsDone', keep);
      try {
        await sleep(REQUEST_GAP_MS);
        const ps = await apiGet('v2/user/personalstats?cat=all', key);
        if (ps && !ps.error && ps.personalstats) GM_setValue('honorsStats', ps.personalstats);
      } catch {
        // no progress bars then – the honors themselves are there
      }
      GM_setValue('honorsError', '');
    } catch (e) {
      GM_setValue('honorsError', e.message);
    } finally {
      GM_setValue('honorsAt', Date.now()); // also after an error, so it isn't retried every few seconds
      honLoading = false;
      renderHonors();
    }
  }

  function getTab() { return GM_getValue('tab', 'list') === 'honors' ? 'honors' : 'list'; }
  const honorsVisible = () => honReady && !$('.twl-honors').hidden && !panel.classList.contains('twl-collapsed');
  // Which page shows: settings over everything, otherwise the chosen tab
  function applyTab() {
    const settingsOpen = !$('.twl-spage').hidden;
    const tab = getTab();
    $('.twl-main').hidden = settingsOpen || tab !== 'list';
    $('.twl-honors').hidden = settingsOpen || tab !== 'honors';
    for (const b of panel.querySelectorAll('[data-act="tab"]')) b.classList.toggle('twl-on', b.dataset.v === tab);
    $('.twl-title-name').textContent = tab === 'honors' ? 'Honors' : 'Watchlist';
    $('.twl-count').hidden = tab === 'honors';
    renderHonors();
  }
  function setTab(v) {
    GM_setValue('tab', v === 'honors' ? 'honors' : 'list');
    if (!$('.twl-spage').hidden) showSettings(false);
    else applyTab();
    if (getTab() === 'honors') refreshHonors(false);
  }
  function toggleIn(key, id) {
    const arr = GM_getValue(key, []);
    GM_setValue(key, arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
    renderHonors();
  }

  function honProgressHtml(id, stats) {
    const pm = HON_PROGRESS[id];
    if (!pm || !stats) return '';
    return (Array.isArray(pm) ? pm : [pm]).map(({ path, target, label, fmt, sub }) => {
      const raw = honStat(stats, path);
      if (raw === null) return '';
      const pct = Math.min(100, Math.round((raw / target) * 100));
      const done = raw >= target;
      const color = done ? '#4ade80' : pct >= 75 ? '#f5a623' : pct >= 40 ? '#60a5fa' : '#8b8b95';
      const val = done ? '✓' : fmt ? fmt(raw, target) : `${honNum(raw)} / ${honNum(target)}`;
      return `<div class="twl-hp"><div class="twl-hp-l"><span>${esc(label)}</span><span style="color:${color}">${esc(val)}</span></div>`
        + `<div class="twl-hp-bar"><i style="width:${pct}%;background:${color}"></i></div>`
        + `${!done && sub ? `<div class="twl-hp-sub">${esc(sub(raw, target))}</div>` : ''}</div>`;
    }).join('');
  }

  function honCardHtml(h, s) {
    const apiEarned = s.mine.has(h.id);
    const marked = s.done.has(h.id);
    const earned = apiEarned || marked;
    const hidden = s.hidden.has(h.id);
    const tier = honTier(h.id);
    const entry = HON_DB[h.id];
    const color = earned ? '#4ade80' : HON_TIER_COLOR[tier];
    const open = hon.open.has(h.id);
    let badges = '';
    if (apiEarned) badges += `<span class="twl-hb" style="color:#4ade80">${esc(t('honEarnedBadge'))}</span>`;
    if (marked && !apiEarned) badges += `<span class="twl-hb" style="color:#60a5fa">${esc(t('honMarkedBadge'))}</span>`;
    if (h.rarity) badges += `<span class="twl-hb" style="color:${HON_RARITY_COLOR[h.rarity] || '#9ca3af'}">${esc(h.rarity)}</span>`;
    const acts = [];
    if (!earned) {
      acts.push(`<button type="button" data-act="hon-guide" data-id="${h.id}" class="twl-hc-gbtn">${esc(t(open ? 'honGuideClose' : 'honGuide'))}</button>`);
    }
    if (!apiEarned) acts.push(`<button type="button" data-act="hon-done" data-id="${h.id}">${esc(t(marked ? 'honUndo' : 'honDone'))}</button>`);
    acts.push(`<button type="button" data-act="hon-hide" data-id="${h.id}">${esc(t(hidden ? 'honUnhide' : 'honHide'))}</button>`);
    const guide = !earned && open
      ? `<div class="twl-hc-guide" data-id="${h.id}"><span class="twl-hb" style="color:${HON_TIER_COLOR[tier]};background:${HON_TIER_BG[tier]}">`
        + `${esc(t('honTierNames')[tier])} · ${esc(t('honTierDescs')[tier])}</span><div>${esc(entry ? entry.g : t('honNoGuide'))}</div></div>`
      : '';
    return `<div class="twl-hc${earned ? ' twl-hc-earned' : ''}${hidden ? ' twl-hc-dim' : ''}" style="--c:${color}">`
      + `<div class="twl-hc-name">${HON_CAT_ICON[h.cat] || '🎖️'} ${esc(h.name)}</div><div class="twl-hc-desc">${esc(h.desc)}</div>`
      + `<img class="twl-hc-bar" loading="lazy" alt="" src="https://www.torn.com/images/honors/${h.id}/f.png">`
      + (badges ? `<div class="twl-hc-badges">${badges}</div>` : '')
      + (earned ? '' : honProgressHtml(h.id, s.stats))
      + `<div class="twl-hc-acts">${acts.join('')}</div>${guide}</div>`;
  }

  function renderHonors() {
    if (!honReady) return;
    const all = GM_getValue('honorsAll', []);
    const s = {
      mine: new Set(GM_getValue('honorsMine', [])),
      done: new Set(GM_getValue('honorsDone', [])),
      hidden: new Set(GM_getValue('honorsHidden', [])),
      stats: GM_getValue('honorsStats', null),
    };
    const isEarned = (id) => s.mine.has(id) || s.done.has(id);
    const earnedCount = all.filter((h) => isEarned(h.id)).length;
    const tabLabel = `🎖 ${t('tabHonors')}${all.length ? ` ${earnedCount}/${all.length}` : ''}`;
    const tabBtn = $('.twl-tab-hon');
    if (tabBtn.textContent !== tabLabel) tabBtn.textContent = tabLabel;
    if ($('.twl-honors').hidden) return;

    const mode = honMode();
    for (const b of panel.querySelectorAll('[data-act="hon-mode"]')) b.classList.toggle('twl-on', b.dataset.v === mode);

    // Pills: difficulty tiers (easy) or categories (chips)
    const pills = $('.twl-hon-pills');
    let pillHtml = '';
    if (mode === 'easy') {
      const guided = all.filter((h) => HON_DB[h.id]);
      pillHtml += `<button type="button" class="twl-hpill${hon.tier === 0 ? ' twl-on' : ''}" data-act="hon-tier" data-v="0">`
        + `${esc(t('honAllTiers', guided.filter((h) => !isEarned(h.id)).length))}</button>`;
      for (let d = 1; d <= 5; d++) {
        const inTier = guided.filter((h) => HON_DB[h.id].d === d);
        if (!inTier.length) continue;
        const left = inTier.filter((h) => !isEarned(h.id)).length;
        const c = left ? HON_TIER_COLOR[d] : '#4ade80';
        pillHtml += `<button type="button" class="twl-hpill${hon.tier === d ? ' twl-on' : ''}" style="--c:${c}" data-act="hon-tier" data-v="${d}">`
          + `${esc(t('honTierNames')[d])} ${left ? left : '✓'}</button>`;
      }
    } else if (mode === 'cat') {
      const counts = {};
      for (const h of all) {
        const c = counts[h.cat] || (counts[h.cat] = { total: 0, earned: 0 });
        c.total++;
        if (isEarned(h.id)) c.earned++;
      }
      const names = t('honCats');
      pillHtml += `<button type="button" class="twl-hpill${hon.cat === -1 ? ' twl-on' : ''}" data-act="hon-cat" data-v="-1">${esc(t('honAllCats'))}</button>`;
      Object.keys(counts).map(Number)
        .sort((a, b) => String(names[a] || a).localeCompare(String(names[b] || b)))
        .forEach((id) => {
          const c = counts[id];
          pillHtml += `<button type="button" class="twl-hpill${hon.cat === id ? ' twl-on' : ''}" data-act="hon-cat" data-v="${id}">`
            + `${HON_CAT_ICON[id] || '🎖️'} ${esc(names[id] || `#${id}`)} <span class="twl-hpill-n">${c.earned}/${c.total}</span></button>`;
        });
    }
    pills.classList.toggle('twl-chips', mode === 'cat');
    pills.hidden = !pillHtml;
    setHtml(pills, pillHtml);

    // Status line + toggles
    const err = GM_getValue('honorsError', '');
    let status;
    if (!getKey()) status = `<span class="twl-hs-m">${esc(t('honNoKey'))}</span>`;
    else if (honLoading) status = esc(t('honLoading'));
    else if (err) status = `<span class="twl-hs-m">${esc(err)}</span>`;
    else if (all.length) {
      const at = GM_getValue('honorsAt', 0);
      status = `<span class="twl-hs-e">${honNum(earnedCount)}</span> / ${honNum(all.length)} · `
        + `${Math.round((earnedCount / all.length) * 100)} %${at ? ` · ${esc(t('honAgo', formatAge(Math.max(0, Math.floor((Date.now() - at) / 1000)))))}` : ''}`;
    } else status = esc(t('honNoData'));
    setHtml($('.twl-hon-status'), status);
    $('.twl-hon-sync').disabled = honLoading || !getKey();
    $('[data-act="hon-earned"]').textContent = t(hon.showEarned ? 'honHideEarned' : 'honShowEarned');
    $('[data-act="hon-earned"]').classList.toggle('twl-on', hon.showEarned);
    $('[data-act="hon-hidden"]').textContent = t(hon.showHidden ? 'honHideHidden' : 'honShowHidden');
    $('[data-act="hon-hidden"]').classList.toggle('twl-on', hon.showHidden);

    // The list
    const listEl = $('.twl-hon-list');
    if (!all.length) {
      setHtml(listEl, `<div class="twl-hon-msg">${esc(!getKey() ? t('honNoKey') : honLoading ? t('honLoading') : err || t('honNoData'))}</div>`);
      return;
    }
    let list = mode === 'easy' ? all.filter((h) => HON_DB[h.id]) : all.slice();
    if (mode === 'easy' && hon.tier) list = list.filter((h) => honTier(h.id) === hon.tier);
    if (mode === 'cat' && hon.cat >= 0) list = list.filter((h) => h.cat === hon.cat);
    if (!hon.showEarned) list = list.filter((h) => !isEarned(h.id));
    if (!hon.showHidden) list = list.filter((h) => !s.hidden.has(h.id));
    const q = hon.search.trim().toLowerCase();
    if (q) {
      list = list.filter((h) => h.name.toLowerCase().includes(q) || h.desc.toLowerCase().includes(q)
        || (HON_DB[h.id] ? HON_DB[h.id].g.toLowerCase().includes(q) : false));
    }
    const rank = (h) => HON_RARITY_RANK[h.rarity] || 0;
    list.sort((a, b) => {
      if (hon.showEarned && isEarned(a.id) !== isEarned(b.id)) return isEarned(a.id) ? 1 : -1;
      if (hon.sort === 'name') return a.name.localeCompare(b.name);
      if (hon.sort === 'rarity') return rank(b) - rank(a);
      return honTier(a.id) - honTier(b.id) || rank(a) - rank(b);
    });

    let html = '';
    const closedTiers = GM_getValue('honClosedTiers', []);
    if (mode === 'easy' && hon.sort === 'diff') {
      // Grouped by difficulty, with a header per tier
      for (let d = 1; d <= 5; d++) {
        if (hon.tier && hon.tier !== d) continue;
        const inTier = all.filter((h) => HON_DB[h.id] && HON_DB[h.id].d === d);
        if (!inTier.length) continue;
        const left = inTier.filter((h) => !isEarned(h.id)).length;
        const cards = list.filter((h) => honTier(h.id) === d);
        if (!cards.length && left) continue;
        // Click on the header folds the tier (remembered)
        const closed = closedTiers.includes(d);
        html += `<button type="button" class="twl-hon-tier" data-act="hon-fold" data-v="${d}" style="color:${HON_TIER_COLOR[d]};background:${HON_TIER_BG[d]}">`
          + `<span class="twl-caret">${closed ? '▸' : '▾'}</span><b>${esc(t('honTierNames')[d])}</b><small>${esc(t('honTierDescs')[d])}</small>`
          + `<span>${esc(left ? t('honTierLeft', left) : t('honTierDone', inTier.length))}</span></button>`;
        if (!closed) html += `<div class="twl-hon-group" data-tier="${d}">${cards.map((h) => honCardHtml(h, s)).join('')}</div>`;
      }
    } else {
      html = list.map((h) => honCardHtml(h, s)).join('');
    }
    setHtml(listEl, html || `<div class="twl-hon-msg">${esc(t('honEmpty'))}</div>`);
  }

  // Search, sort, missing honor bar images
  $('.twl-hon-search').addEventListener('input', (ev) => { hon.search = ev.target.value; renderHonors(); });
  $('.twl-hon-sort').addEventListener('change', (ev) => { hon.sort = ev.target.value; renderHonors(); });
  $('.twl-hon-list').addEventListener('error', (ev) => {
    const img = ev.target;
    if (img instanceof HTMLImageElement && img.classList.contains('twl-hc-bar')) img.remove(); // no bar image for this honor
  }, true);
  for (const k of ['honorsDone', 'honorsHidden', 'honorsMine', 'honorsAll', 'honMode']) {
    GM_addValueChangeListener(k, (_k, _o, _n, remote) => { if (remote) renderHonors(); });
  }
  honReady = true;
  applyTab();

  applyLayout();
  syncHeaderMode();
  render();
  refreshAll(false);
  if (getTab() === 'honors') refreshHonors(false);
  scheduleNyan();
  updateChain();
  setInterval(updateChain, 250); // more often than 1×/s so the display doesn't lag behind Torn's timer

  // Every second: recalculate times/colors; every few seconds check whether an API refresh is due.
  let tick = 0;
  setInterval(() => {
    render();
    decorateWarRows(); // keeps ➕/✓ in sync when the list changes in another tab
    syncHeaderMode();
    if (++tick % 5 === 0) refreshAll(false);
    if (tick % 15 === 0 && honorsVisible()) { // honors: refetch when due, keep "x min ago" current
      refreshHonors(false);
      renderHonors();
    }
  }, 1000);
})();
