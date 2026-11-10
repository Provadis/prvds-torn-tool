// ==UserScript==
// @name         Torn War Watchlist
// @namespace    torn-war-watchlist
// @version      2.16.0
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
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ---- Settings -----------------------------------------------------------
  const DEFAULT_REFRESH_S = 60;   // default: refresh the whole list every 60 s (changeable in the panel)
  const MIN_REFRESH_S = 15;
  const MAX_REFRESH_S = 600;
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
      hbtnTitle: 'Watchlist öffnen / schließen',
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
      hbtnTitle: 'Open / close the watchlist',
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
    .twl-hbtn { position: absolute; z-index: 10; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box;
      height: 30px; min-width: 30px; padding: 0 7px; margin: 0; border-radius: 6px; border: 2px solid #2a1a0e;
      background: #ff7518; color: #fff; font: bold 17px/1 Arial, sans-serif; white-space: nowrap; cursor: pointer;
      -webkit-tap-highlight-color: transparent; }
    .twl-hbtn.twl-hbtn-chain { font-size: 14px; }
    .twl-hbtn.twl-hbtn-chain.twl-hbtn-compact { font-size: 12px; padding: 0 4px; }
    .twl-hbtn.twl-hbtn-open { background: #c4560f; box-shadow: inset 0 2px 4px rgba(0,0,0,.4); }
    .twl-hbtn.twl-hbtn-alert { background: #d00000; box-shadow: 0 0 10px 2px rgba(255,0,0,.8); animation: twl-blink 1s steps(1) infinite; }
    #twl-panel.twl-inline { position: relative !important; left: auto !important; top: auto !important; right: auto !important;
      width: auto !important; height: calc(100vh - 12px) !important; height: calc(100dvh - 12px) !important; margin: 6px; z-index: 5; }
    #twl-panel.twl-inline.twl-collapsed { display: none !important; }
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
      <span class="twl-title" data-i18n-title="dragHint">🎃 Watchlist <span class="twl-count"></span></span>
      <button data-act="pause" class="twl-pause"></button>
      <button data-act="refresh" data-i18n-title="refreshNow">⟳</button>
      <button data-act="settings" class="twl-settings-btn" data-i18n-title="settings">⚙</button>
      <button data-act="side" data-i18n-title="dock">⇄</button>
      <button data-act="collapse" data-i18n-title="collapse">–</button>
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
      <div class="twl-spage" hidden>
        <div class="twl-sp-head">
          <button data-act="settings" data-i18n="back"></button>
          <b data-i18n="settings"></b>
        </div>
        <div class="twl-settings">
          <span data-i18n="language"></span>
          <select class="twl-lang"><option value="de">Deutsch</option><option value="en">English</option></select>
        </div>
        <div class="twl-settings">
          <span class="twl-version"></span>
          <button data-act="update-check" data-i18n="checkUpdates" data-i18n-title="checkUpdatesTitle"></button>
          <span class="twl-upd-status"></span>
        </div>
        <div class="twl-settings">
          <button data-act="key" data-i18n="apiKey" data-i18n-title="apiKeyTitle"></button>
          <span class="twl-key-status"></span>
        </div>
        <div class="twl-settings">
          <span data-i18n="updateEvery"></span>
          <input type="number" class="twl-interval" min="${MIN_REFRESH_S}" max="${MAX_REFRESH_S}" step="5" /> s
          <span class="twl-rate"></span>
        </div>
        <div class="twl-settings">
          <label><input type="checkbox" class="twl-ff-toggle" /> 📊 FF Scouter</label>
          <button data-act="ff-key" data-i18n="ffKey" data-i18n-title="ffKeyTitle"></button>
          <button data-act="ff-reload" class="twl-ff-reload" data-i18n="ffReload" data-i18n-title="ffReloadTitle"></button>
          <span class="twl-ff-status"></span>
        </div>
        <div class="twl-settings">
          <label><input type="checkbox" class="twl-hits-toggle" /> 🎯 Today's Hits</label>
          <label><input type="checkbox" class="twl-chain-toggle" /> <span data-i18n="chainToggle"></span></label>
          <label><input type="checkbox" class="twl-nyan-toggle" /> 🌈 Nyan Cat</label>
        </div>
        <div class="twl-settings">
          <label data-i18n-title="soundTitle"><input type="checkbox" class="twl-sound-toggle" /> <span data-i18n="sound"></span></label>
          <input type="range" class="twl-sound-vol" min="0" max="100" step="5" data-i18n-title="volume" />
          <button data-act="sound-test" data-i18n-title="soundTestTitle">▶ Test</button>
        </div>
        <div class="twl-settings">
          <button data-act="export" data-i18n-title="exportTitle">⬇ Export</button>
          <button data-act="import" data-i18n-title="importTitle">⬆ Import</button>
          <input type="file" accept=".json,application/json" class="twl-import-input" hidden />
        </div>
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
  // Header mode (touch only): a "P" button right after the ☰ menu in Torn's header, and the panel
  // sits inline below the header instead of floating. Without a spot in the header, the floating
  // "P" square stays in use.
  const headerBtn = document.createElement('button');
  headerBtn.type = 'button';
  headerBtn.className = 'twl-hbtn';
  headerBtn.textContent = 'P';
  let headerMode = false;
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

  function applyLayout() {
    // Header mode: the panel lives in the page right below Torn's header, in full screen height
    panel.classList.toggle('twl-inline', headerMode);
    if (headerMode) {
      const collapsed = GM_getValue('collapsed', false);
      const root = document.getElementById('header-root');
      if (root && root.nextElementSibling !== panel) root.after(panel);
      panel.classList.toggle('twl-collapsed', collapsed);
      panel.classList.remove('twl-mini-mode', 'twl-right', 'twl-left');
      panel.classList.add('twl-sized'); // flex layout, the list scrolls inside
      panel.style.left = panel.style.top = panel.style.right = panel.style.width = panel.style.height = '';
      headerBtn.classList.toggle('twl-hbtn-open', !collapsed);
      return;
    }
    if (panel.parentElement !== document.body) document.body.appendChild(panel);
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
    // Not enough room before Torn's icons on the right for "⛓ 01:12"? Then a compact "01:12"
    const nav = document.querySelector('#header-root .header-navigation');
    if (nav) {
      const room = nav.getBoundingClientRect().left - headerBtn.getBoundingClientRect().left - 4;
      headerBtn.classList.toggle('twl-hbtn-compact', room < 80);
    }
  }
  function syncHeaderMode() {
    if (!IS_TOUCH) return;
    if (!headerBtn.isConnected || !headerSpot || !headerSpot.isConnected) {
      headerSpot = findHeaderSpot();
      if (headerSpot) headerSpot.after(headerBtn); // Torn redraws its header now and then – put it back
    }
    placeHeaderBtn();
    if (headerBtn.isConnected !== headerMode) {
      headerMode = headerBtn.isConnected;
      applyLayout();
    }
  }
  window.addEventListener('resize', placeHeaderBtn);
  headerBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const open = GM_getValue('collapsed', false);
    GM_setValue('collapsed', !open);
    applyLayout();
    if (open) window.scrollTo({ top: 0, behavior: 'smooth' }); // header + panel in view, even when scrolled down
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
    for (const e of rows) {
      const row = $(`.twl-row[data-id="${e.id}"]`);
      if (!row) continue; // group collapsed
      // Color still by last action, the status (hospital countdown) is displayed
      row.className = `twl-row ${colorClass(e.age)}`;
      row.querySelector('.twl-age').textContent = statusLabel(e.status, now);
      row.title = e.age == null ? '' : t('lastAction', formatAge(e.age));
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
    const perMin = Math.round(calls * 60 / getRefreshS());
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
      case 'refresh': refreshAll(true); break;
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
        const groups = GM_getValue('collapsedGroups', {});
        if (groups[btn.dataset.gid]) delete groups[btn.dataset.gid];
        else groups[btn.dataset.gid] = true;
        GM_setValue('collapsedGroups', groups);
        render();
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
  function checkForUpdate() {
    const status = $('.twl-upd-status');
    status.className = 'twl-upd-status';
    status.textContent = t('updChecking');
    GM_xmlhttpRequest({
      method: 'GET',
      url: `${UPDATE_URL}?t=${Date.now()}`, // skip caches
      timeout: 15000,
      onload: (r) => {
        const m = r.status === 200 && r.responseText.match(/@version\s+([\d.]+)/);
        if (!m) { status.textContent = t('updFailed'); status.classList.add('twl-ff-err'); return; }
        if (!newerVersion(m[1], SCRIPT_VERSION)) { status.textContent = t('updLatest'); return; }
        status.innerHTML = `${esc(t('updAvailable', m[1]))} · <a href="${esc(UPDATE_URL)}" target="_blank" `
          + `rel="noopener" title="${esc(t('updInstallTitle'))}">${esc(t('updInstall'))}</a>`;
        status.classList.add('twl-upd-new');
      },
      onerror: () => { status.textContent = t('updFailed'); status.classList.add('twl-ff-err'); },
      ontimeout: () => { status.textContent = t('updFailed'); status.classList.add('twl-ff-err'); },
    });
  }

  // Show the settings page instead of the list (per tab, not saved).
  // If the panel is collapsed, ⚙ expands it.
  function showSettings(open) {
    $('.twl-spage').hidden = !open;
    $('.twl-main').hidden = open;
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
    langSelect.value = getLang();
    $('.twl-version').textContent = t('version', SCRIPT_VERSION);
    headerBtn.title = t('hbtnTitle');
    $('[data-act="update-check"]').style.display = UPDATE_URL ? '' : 'none';
    renderLegend();
  }
  const langSelect = $('.twl-lang');
  langSelect.addEventListener('change', () => {
    GM_setValue('lang', langSelect.value);
    applyLang();
    render();
    updateChain();
  });
  applyLang();

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
    const bar = document.querySelector('#barChain, [id^="barChain"], [class*="chain-bar"]');
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
    const valueEl = bar.querySelector('[class*="bar-value"]');
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

  const readChain = () => readSidebarChain() || readAttackChain();

  const parseClock = (t) => {
    const parts = t.split(':').map(Number);
    return parts.length >= 2 && parts.every(Number.isFinite) ? parts.reduce((s, n) => s * 60 + n, 0) : null;
  };

  function updateChain() {
    const box = $('.twl-chain');
    const show = chainEnabled();
    const chain = show || soundEnabled() || headerMode ? readChain() : null;
    box.style.display = show && chain ? '' : 'none';
    const left = chain ? parseClock(chain.time) : null;
    updateBomb(left);
    // Header button: "P", or "⛓ mm:ss" while a chain runs – red and blinking below 1:30
    if (headerMode) {
      const running = left != null && left > 0;
      const compact = headerBtn.classList.contains('twl-hbtn-compact');
      const label = running ? (compact ? chain.time : `⛓ ${chain.time}`) : 'P';
      if (headerBtn.textContent !== label) headerBtn.textContent = label;
      headerBtn.classList.toggle('twl-hbtn-chain', running);
      headerBtn.classList.toggle('twl-hbtn-alert', running && left < CHAIN_ALERT_S);
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
  GM_addValueChangeListener('soundVol', (_k, _o, n, remote) => {
    if (!remote) return;
    volInput.value = n;
    if (master) master.gain.value = n / 100;
  });

  applyLayout();
  syncHeaderMode();
  render();
  refreshAll(false);
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
  }, 1000);
})();
