// ==UserScript==
// @name         Torn War Watchlist
// @namespace    torn-war-watchlist
// @version      2.11.0
// @description  Watchlist für Gegner im Ranked War: Spieler und ganze Factions, Hospital-Countdown, Farbe nach Last Action, FF Scouter
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
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ---- Einstellungen ------------------------------------------------------
  const DEFAULT_REFRESH_S = 60;   // Standard: alle 60s die komplette Liste neu holen (im Panel änderbar)
  const MIN_REFRESH_S = 15;
  const MAX_REFRESH_S = 600;
  const REQUEST_GAP_MS = 700;     // Abstand zwischen API-Calls (Torn-Limit: 100/min)
  // Version und Update-Adresse kommen aus dem Header (@version / @downloadURL)
  const GMI = typeof GM_info !== 'undefined' ? GM_info : null;
  const SCRIPT_VERSION = (GMI && GMI.script.version) || '';
  const UPDATE_URL = (GMI && (GMI.script.downloadURL || GMI.script.updateURL))
    || 'https://raw.githubusercontent.com/Provadis/torn-war-watchlist/main/torn-war-watchlist.user.js';
  const GREEN_AFTER_S = 15 * 60;  // > 15 min inaktiv  -> grün
  const ORANGE_AFTER_S = 10 * 60; // 10–15 min inaktiv -> orange, darunter rot

  // ---- Speicher (geteilt zwischen allen Torn-Tabs) ------------------------
  const getList = () => GM_getValue('list', []);
  const setList = (list) => GM_setValue('list', list);
  const getKey = () => GM_getValue('apiKey', '');
  const getRefreshS = () => GM_getValue('refreshS', DEFAULT_REFRESH_S);
  const isPaused = () => GM_getValue('paused', false);

  // Beobachtete Factions: { id, name, tag, hidden: [Spieler-IDs], members: [{ id, name, ts }], error }
  // Ihre Mitglieder kommen mit EINEM Call pro Faction; "hidden" blendet einzelne Spieler nur aus.
  const getFactions = () => GM_getValue('factions', []);
  const setFactions = (factions) => GM_setValue('factions', factions);

  // Dauerhafte Einstellungen (für Export/Import und die Sicherung); Zwischenspeicher wie Hits
  // oder der letzte Refresh gehören nicht dazu. Pro Schlüssel eine Prüfung des Werts.
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

  // ---- Sprache (Deutsch / Englisch) ----------------------------------------
  // t('key', ...args): Texte ohne Platzhalter sind Strings, mit Platzhaltern Funktionen.
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
      checkUpdatesTitle: 'Öffnet die Skript-Datei – Tampermonkey zeigt dann, ob es eine neuere Version gibt',
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
      checkUpdatesTitle: 'Opens the script file – Tampermonkey then shows whether a newer version exists',
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
    },
  };
  const getLang = () => (GM_getValue('lang', 'de') === 'en' ? 'en' : 'de');
  function t(key, ...args) {
    const s = I18N[getLang()][key] ?? I18N.de[key];
    return typeof s === 'function' ? s(...args) : s;
  }

  // Sicherung im localStorage von torn.com: Geht der Tampermonkey-Speicher verloren oder ist er
  // älter als die Sicherung, wird beim Laden die Sicherung zurückgespielt. "savedAt" steht in
  // beiden Speichern und entscheidet, welcher aktueller ist.
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
      console.warn('[Watchlist] Sicherung im localStorage fehlgeschlagen:', e);
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
      saveBackup(); // erste Sicherung anlegen bzw. veraltete erneuern
    }
  })();
  // Jede eigene Änderung (nicht die aus anderen Tabs) landet kurz danach auch in der Sicherung
  for (const k of Object.keys(SETTINGS)) {
    GM_addValueChangeListener(k, (_k, _o, _n, remote) => { if (!remote) scheduleBackup(); });
  }
  window.addEventListener('pagehide', () => { if (backupTimer) saveBackup(); });

  function updateEntry(id, patch) {
    const list = getList();
    const entry = list.find((e) => e.id === id);
    if (!entry) return; // inzwischen entfernt
    Object.assign(entry, patch);
    setList(list);
  }

  function updateFaction(id, patch) {
    const factions = getFactions();
    const f = factions.find((x) => x.id === id);
    if (!f) return; // inzwischen entfernt
    Object.assign(f, patch);
    setFactions(factions);
  }

  // Spieler-IDs, deren Daten schon über eine beobachtete Faction kommen (brauchen keinen eigenen Call)
  function coveredIds(factions) {
    return new Set(factions.flatMap((f) => f.members.map((m) => m.id)));
  }

  function addPlayer(id) {
    // Steckt der Spieler in einer beobachteten Faction, wird er dort nur wieder eingeblendet.
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

  // ✕ bei einem Spieler: aus der Einzelliste löschen und in beobachteten Factions ausblenden.
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

  // Status aus der API (Hospital, Jail, Traveling, …); "until" = Zeitpunkt, an dem er endet
  const statusOf = (s) => (s ? { state: s.state || '', until: s.until || 0 } : null);

  const profileFaction = (d) => {
    const f = d.faction || {};
    return f.faction_id
      ? { id: f.faction_id, name: f.faction_name, tag: f.faction_tag || '' }
      : { id: 0, name: 'Ohne Faction', tag: '' };
  };

  // Einzelner Spieler. Liefert den Torn-Fehlercode zurück (oder 0), damit die Schleife bei
  // Key-Problemen abbrechen kann.
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

  // Ganze Faction mit einem Call (/v2/faction/{id}/members). Der Name wird nur einmal geholt.
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

  // ---- Today's Hits: eigene erfolgreiche Angriffe seit 00:00 TCT (= UTC) ----------------
  // Braucht einen Key mit Limited Access. Zählt inkrementell: pro Update meist nur ein Call.
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
    if (h.denied && GM_getValue('hitsDeniedKey', '') === key) return; // Key hat keine Rechte – Calls sparen
    hitsLoading = true;
    try {
      // Eigene Spieler-ID einmalig holen (pro Key gemerkt)
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
      for (let page = 0; page < 10; page++) { // max. 1000 Angriffe pro Update nachladen
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
    if (h.day === todayStart()) GM_setValue('hits', h); // Tageswechsel während der Abfrage? Dann verwerfen.
  }

  // ---- FF Scouter: Fair-Fight-Schätzung pro Spieler (ffscouter.com) -------------------------
  // Braucht einen Torn-API-Key, der bei ffscouter.com registriert ist (eigener Key oder der
  // Watchlist-Key). Die Werte ändern sich langsam und werden zwischengespeichert; FF hängt aber
  // auch von den eigenen Stats ab, deshalb nach einer Weile neu holen.
  const FF_API = 'https://ffscouter.com/api/v1';
  const FF_MAX_AGE_MS = 30 * 60 * 1000;
  const FF_CHUNK = 100;               // Spieler pro Abfrage
  const FF_OLD_S = 14 * 86400;        // ältere Schätzungen bekommen ein "?"
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
        for (const id of chunk) cache[id] = { ff: null, bs: null, upd: null, fetched: t }; // keine Daten
        for (const r of d) {
          if (r && r.player_id) {
            cache[r.player_id] = { ff: r.fair_fight ?? null, bs: r.bs_estimate_human ?? null, upd: r.last_updated ?? null, fetched: t };
          }
        }
        // Einträge, die seit einem Tag niemand mehr gebraucht hat, wegwerfen
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

  // Alle angezeigten Spieler: Mitglieder beobachteter Factions (ohne ausgeblendete) + Einzelspieler
  function shownIds() {
    const ids = new Set();
    for (const f of getFactions()) {
      const hidden = new Set(f.hidden);
      for (const m of f.members) if (!hidden.has(m.id)) ids.add(m.id);
    }
    for (const e of getList()) ids.add(e.id);
    return [...ids];
  }

  const KEY_ERRORS = [1, 2, 10, 13, 16, 18]; // Key fehlt/falsch/gesperrt/zu wenig Rechte
  let refreshing = false;

  async function refreshAll(force) {
    if (refreshing) return;
    const key = getKey();
    if (!key) return;
    // Pausiert: keine automatischen Abfragen (⟳ holt trotzdem einmal manuell).
    if (!force && isPaused()) return;
    // Nur ein Tab aktualisiert pro Intervall, die anderen bekommen die Daten über den Speicher.
    if (!force && Date.now() - GM_getValue('lastRefresh', 0) < getRefreshS() * 1000) return;
    GM_setValue('lastRefresh', Date.now());
    refreshing = true;
    render();
    try {
      let calls = 0;
      const next = async () => {
        if (calls++) await sleep(REQUEST_GAP_MS);
        return force || !isPaused(); // während eines laufenden Durchlaufs pausiert?
      };
      // 1) Factions: ein Call pro Faction
      for (const fid of getFactions().map((f) => f.id)) {
        if (!(await next())) return;
        if (KEY_ERRORS.includes(await refreshFaction(fid, key))) return;
      }
      // 2) Einzelne Spieler – außer denen, die schon über eine Faction abgedeckt sind
      const covered = coveredIds(getFactions());
      for (const id of getList().map((e) => e.id).filter((pid) => !covered.has(pid))) {
        if (!(await next())) return;
        if (KEY_ERRORS.includes(await refreshOne(id, key))) return;
      }
      // 3) Today's Hits (eigener Fehler, bricht die Watchlist nicht ab)
      if (hitsEnabled()) {
        if (!(await next())) return;
        await refreshHits(key);
      }
      // 4) FF Scouter (eigener Server, zählt nicht gegen Torns Limit) – nur veraltete/neue Spieler
      if (ffEnabled() && ffStale(shownIds()).length) {
        if (!(await next())) return;
        await refreshFF(shownIds());
      }
    } finally {
      refreshing = false;
      render();
    }
  }

  // ---- Hilfsfunktionen -----------------------------------------------------
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

  // Faction eines Spielers, soweit schon bekannt (ohne API-Call)
  const lookedUpFactions = {};
  function knownFactionOf(pid, factions) {
    const f = factions.find((x) => x.members.some((m) => m.id === pid));
    if (f) return { id: f.id, name: f.name, tag: f.tag };
    const e = getList().find((x) => x.id === pid);
    return (e && e.faction) || lookedUpFactions[pid] || null;
  }

  // "+ Faction des Spielers": Faction notfalls mit einem Profil-Call nachschlagen
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
        delete $('.twl-profile').dataset.html; // Button neu zeichnen
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

  // Restzeit im Hospital in Sekunden (0 = nicht im Hospital bzw. schon raus)
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
    /* Scrollbalken im Kürbis-Look (Chrome/Edge/Safari über ::-webkit-scrollbar, Firefox über scrollbar-color) */
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
    .twl-resize { position: absolute; bottom: 0; width: 14px; height: 14px; touch-action: none; opacity: .7; }
    .twl-resize:hover { opacity: 1; }
    #twl-panel.twl-right .twl-resize { left: 0; cursor: nesw-resize;
      background: linear-gradient(45deg, #ff7518 0 2px, transparent 2px 5px, #ff7518 5px 7px, transparent 7px); border-radius: 0 0 0 6px; }
    #twl-panel.twl-left .twl-resize { right: 0; cursor: nwse-resize;
      background: linear-gradient(-45deg, #ff7518 0 2px, transparent 2px 5px, #ff7518 5px 7px, transparent 7px); border-radius: 0 0 6px 0; }
    #twl-panel.twl-collapsed .twl-resize { display: none; }
    #twl-panel.twl-right { right: 6px; }
    #twl-panel.twl-left { left: 6px; }
    #twl-panel button { background: #333; color: #eee; border: 1px solid #555; border-radius: 3px; cursor: pointer; padding: 1px 6px; font: inherit; }
    #twl-panel button:hover { background: #444; }
    .twl-head { display: flex; align-items: center; gap: 4px; padding: 5px 6px; background: #2a1a0e; border-radius: 6px 6px 0 0;
      cursor: move; user-select: none; touch-action: none; }
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
    /* Torn färbt Links selbst ein (teils rot) – daher hier erzwingen. */
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
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'twl-panel';
  panel.innerHTML = `
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
    <div class="twl-resize" data-i18n-title="resize"></div>`;
  document.body.appendChild(panel);

  const $ = (sel) => panel.querySelector(sel);
  const input = $('.twl-add input');

  // Position: entweder am rechten/linken Rand angedockt ("side") oder frei verschoben ("pos").
  // Frei verschoben ist das Panel oben links verankert, es wächst beim Resizen also nach rechts.
  function clampPos(x, y) {
    const r = panel.getBoundingClientRect();
    return {
      x: Math.round(Math.min(Math.max(0, x), Math.max(0, window.innerWidth - r.width))),
      y: Math.round(Math.min(Math.max(0, y), Math.max(0, window.innerHeight - 30))),
    };
  }

  function applyLayout() {
    const pos = GM_getValue('pos', null);
    const side = pos ? 'left' : GM_getValue('side', 'right');
    panel.classList.toggle('twl-right', side === 'right');
    panel.classList.toggle('twl-left', side === 'left');
    const collapsed = GM_getValue('collapsed', false);
    panel.classList.toggle('twl-collapsed', collapsed);
    const size = GM_getValue('size', null);
    panel.style.width = size ? `${size.w}px` : '';
    panel.style.height = size && !collapsed ? `${size.h}px` : '';
    panel.classList.toggle('twl-sized', !!size && !collapsed);
    // Gespeicherte Position nur anzeigen, nicht überschreiben – bei kleinerem Fenster ins Bild schieben
    const p = pos ? clampPos(pos.x, pos.y) : null;
    panel.style.left = p ? `${p.x}px` : '';
    panel.style.top = p ? `${p.y}px` : '';
    panel.style.right = p ? 'auto' : '';
  }
  window.addEventListener('resize', applyLayout);

  // Verschieben: am Kopf ziehen (nicht an den Buttons). Doppelklick dockt wieder an den Rand an.
  const head = $('.twl-head');
  head.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || ev.target.closest('button')) return;
    ev.preventDefault();
    head.setPointerCapture(ev.pointerId);
    const rect = panel.getBoundingClientRect();
    const start = { x: ev.clientX, y: ev.clientY, left: rect.left, top: rect.top };
    let pos = null;
    const move = (e) => {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!pos && Math.abs(dx) + Math.abs(dy) < 4) return; // kleiner Wackler ist kein Ziehen
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
    if (ev.target.closest('button')) return;
    GM_setValue('pos', null);
    applyLayout();
  });

  // Größe ändern über den Griff in der unteren Ecke (Richtung Bildschirmmitte bzw. nach rechts,
  // wenn das Panel frei verschoben ist).
  const handle = $('.twl-resize');
  handle.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    handle.setPointerCapture(ev.pointerId);
    const rect = panel.getBoundingClientRect();
    const start = { x: ev.clientX, y: ev.clientY, w: rect.width, h: rect.height };
    const dir = panel.classList.contains('twl-right') ? -1 : 1;
    let size = null;
    const move = (e) => {
      const w = Math.min(window.innerWidth - 20, Math.max(180, start.w + dir * (e.clientX - start.x)));
      const h = Math.min(window.innerHeight - rect.top - 10, Math.max(120, start.h + (e.clientY - start.y)));
      size = { w: Math.round(w), h: Math.round(h) };
      panel.style.width = `${size.w}px`;
      panel.style.height = `${size.h}px`;
      panel.classList.add('twl-sized');
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      if (size) GM_setValue('size', size);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
  handle.addEventListener('dblclick', () => {
    GM_setValue('size', null);
    applyLayout();
  });

  function setHtml(el, html) {
    if (el.dataset.html === html) return;
    el.dataset.html = html;
    el.innerHTML = html;
  }

  // FF-Anzeige einer Zeile: Zahl in Farbe von blau (leicht, FF 1) bis rot (schwer, FF 5+)
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

    // Angezeigte Spieler: Mitglieder beobachteter Factions (ohne ausgeblendete) + Einzelspieler
    const shown = new Map();
    for (const f of factions) {
      const hidden = new Set(f.hidden);
      for (const m of f.members) {
        if (!hidden.has(m.id)) shown.set(m.id, { ...m, error: null, faction: { id: f.id, name: f.name, tag: f.tag } });
      }
    }
    for (const e of list) if (!shown.has(e.id)) shown.set(e.id, e);
    $('.twl-count').textContent = `(${shown.size})`;

    // Buttons für das gerade geöffnete Spieler- bzw. Faction-Profil
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

    // Liste: wer nicht im Hospital ist zuerst (am längsten inaktive oben), danach nach
    // Hospital-Restzeit – wer als Nächstes rauskommt, steht weiter oben.
    const rows = [...shown.values()]
      .map((e) => ({ ...e, age: e.ts ? Math.max(0, now - e.ts) : null, hosp: hospitalLeft(e.status, now) }))
      .sort((a, b) => a.hosp - b.hosp || (b.age ?? -1) - (a.age ?? -1));

    // Nach Faction gruppieren (Reihenfolge innerhalb der Gruppe bleibt wie oben sortiert).
    // Beobachtete Factions (★) zuerst, dann übrige alphabetisch, "Ohne Faction"/"Noch nicht geladen" ans Ende.
    const groups = new Map();
    for (const f of factions) {
      groups.set(f.id, { id: f.id, name: f.name || `Faction ${f.id}`, tag: f.tag, watched: f, rows: [] });
    }
    for (const e of rows) {
      const f = e.faction || { id: 'unknown', name: t('notLoaded'), tag: '' };
      // "Ohne Faction" kommt gespeichert aus der API-Antwort – in der aktuellen Sprache anzeigen
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
    // Zusatzzeilen einer beobachteten Faction: Fehler / noch keine Daten / Wiederherstellen-Button
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

    // Struktur nur neu bauen, wenn sich etwas geändert hat; sonst nur Zeit + Farbe
    // aktualisieren, damit Klicks nicht durch das sekündliche Neuzeichnen verloren gehen.
    setHtml($('.twl-list'), sortedGroups.length
      ? sortedGroups.map(groupHtml).join('')
      : `<div class="twl-empty">${t('emptyList')}</div>`);
    const ffOn = ffEnabled();
    const ffCache = ffOn ? getFfCache() : {};
    for (const e of rows) {
      const row = $(`.twl-row[data-id="${e.id}"]`);
      if (!row) continue; // Gruppe zugeklappt
      // Farbe weiterhin nach Last Action, angezeigt wird der Status (Hospital-Countdown)
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
    // Farbzähler im Gruppenkopf, damit man auch zugeklappt sieht, wer wie lange weg ist
    for (const g of sortedGroups) {
      const counts = {};
      for (const e of g.rows) counts[colorClass(e.age)] = (counts[colorClass(e.age)] || 0) + 1;
      const badges = ['twl-green', 'twl-orange', 'twl-red', 'twl-unknown']
        .filter((c) => counts[c])
        .map((c) => `<span class="twl-b ${c}">${counts[c]}</span>`)
        .join('');
      setHtml($(`.twl-group[data-gid="${g.id}"] .twl-badges`), badges);
    }

    // Geschätzter API-Verbrauch der Watchlist (Limit: 100/min pro Account, alle Keys zusammen):
    // ein Call pro Faction + einer pro Einzelspieler, der nicht schon über eine Faction kommt
    const covered = coveredIds(factions);
    const hits = getHits();
    const hitsCall = hitsEnabled() && !(hits.denied && GM_getValue('hitsDeniedKey', '') === getKey()) ? 1 : 0;
    const calls = factions.length + list.filter((e) => !covered.has(e.id)).length + hitsCall;
    const perMin = Math.round(calls * 60 / getRefreshS());
    const rate = $('.twl-rate');
    rate.textContent = t('perMin', perMin);
    rate.title = t('callsPerUpdate', calls);
    rate.classList.toggle('twl-warn', perMin > 60);

    // Today's Hits-Leiste (auch bei eingeklapptem Panel sichtbar)
    const hitsBtn = $('.twl-hits');
    hitsBtn.style.display = hitsEnabled() ? '' : 'none';
    setHtml(hitsBtn, `${t('hitsStrip', hits.hits)}${hitsLoading ? ' …' : ''}`
      + (hits.error ? ` <span class="twl-hits-err">(${esc(hits.error)})</span>` : ''));
    hitsBtn.title = t('hitsTitle', hits.attempts, hits.hits, hits.warHits);

    // FF-Scouter-Status: Fehler oder welcher Key benutzt wird
    const ffStatus = $('.twl-ff-status');
    const ffErr = GM_getValue('ffError', '');
    ffStatus.className = `twl-ff-status${ffErr ? ' twl-ff-err' : ''}`;
    ffStatus.textContent = !ffOn ? '' : ffErr || (GM_getValue('ffKey', '') ? t('ffOwnKey') : getKey() ? t('ffWatchlistKey') : t('ffNoKey'));
    ffStatus.title = ffErr ? `FF Scouter: ${ffErr}` : '';

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
    // Abfragen pro Minute unten rechts – nur wenn auch wirklich abgefragt wird
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
        GM_setValue('ffCache', {}); // FF hängt vom Key-Besitzer ab -> alles neu holen
        GM_setValue('ffError', '');
        if (ffEnabled()) refreshFF(shownIds()).then(render);
        render();
        break;
      }
      case 'import': $('.twl-import-input').click(); break;
      case 'hits': {
        const key = getKey();
        if (!key) break;
        GM_setValue('hitsDeniedKey', ''); // bewusster Klick: auch nach Rechte-Fehler nochmal versuchen
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
        // Beim Fortsetzen sofort aktualisieren statt aufs nächste Intervall zu warten.
        if (!isPaused()) refreshAll(true);
        render();
        break;
      case 'side':
        // Frei verschoben? Dann erst einmal wieder an den bisherigen Rand andocken.
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
        // Tampermonkey fängt .user.js-Links ab und zeigt Update-Dialog bzw. "ist aktuell"
        if (UPDATE_URL) window.open(UPDATE_URL, '_blank');
        break;
    }
  });

  // Einstellungsseite statt der Liste anzeigen (pro Tab, wird nicht gespeichert).
  // Ist das Panel eingeklappt, klappt ⚙ es dafür auf.
  function showSettings(open) {
    $('.twl-spage').hidden = !open;
    $('.twl-main').hidden = open;
    $('.twl-settings-btn').classList.toggle('twl-on', open);
    if (open && GM_getValue('collapsed', false)) {
      GM_setValue('collapsed', false);
      applyLayout();
    }
  }

  // ---- Legende (in den Einstellungen): Beispielzeilen mit einem erfundenen Spieler ---------
  const LEGEND_FAKE_ID = 1234567; // Fantasie-ID, kein echter Account
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
  // Feste Texte im Panel (data-i18n = Text, data-i18n-title = Tooltip) in der gewählten Sprache
  function applyLang() {
    for (const el of panel.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of panel.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
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

  // ---- Chain-Timer: direkt aus Torns Sidebar gelesen (keine API-Calls) ---------------------
  const CHAIN_ALERT_S = 90; // unter 1:30 blinkt es rot
  const chainEnabled = () => GM_getValue('chainOn', true);

  // Sucht die Chain-Leiste in der Sidebar. Torn hängt an Klassennamen zufällige Endungen an
  // (z.B. "bar-value___xY12"), daher Teiltreffer; als Notlösung über das Label "Chain:".
  function findChainBar() {
    const bar = document.querySelector('#barChain, [id^="barChain"], [class*="chain-bar"]');
    if (bar) return bar;
    const label = [...document.querySelectorAll('#sidebar p, #sidebar span, [class*="sidebar"] p, [class*="sidebar"] span')]
      .find((el) => /^chain:?$/i.test(el.textContent.trim()));
    return label ? label.closest('a, li, div') : null;
  }

  // Torn kürzt große Zahlen ab ("2615/5k"); manchmal steht das "k" nur in einem CSS-::after.
  const CHAIN_VALUE_RE = /(\d[\d,.]*)\s*([kKmM]?)\s*\/\s*(\d[\d,.]*)\s*([kKmM]?)/;
  const pseudoText = (el, which) => {
    const c = getComputedStyle(el, which).content;
    return c && c !== 'none' && c !== 'normal' ? c.replace(/^["']|["']$/g, '') : '';
  };
  // Sichtbarer Text inkl. CSS-::before/::after aller verschachtelten Elemente. Zwischen Elementen
  // steht ein Leerzeichen, sonst kleben Werte zusammen ("4/10" + "02:57" -> "4/1002:57").
  const visibleText = (el) => pseudoText(el, '::before')
    + [...el.childNodes].map((n) => (n.nodeType === 1 ? ` ${visibleText(n)} ` : n.nodeType === 3 ? n.textContent : '')).join('')
    + pseudoText(el, '::after');
  function parseCount(num, suffix) {
    const mult = { k: 1e3, m: 1e6 }[suffix.toLowerCase()] || 1;
    // Mit Suffix ist "." ein Dezimalpunkt (2.5k), ohne sind "," und "." Tausendertrenner
    const n = mult > 1 ? parseFloat(num.replace(/,/g, '')) : parseInt(num.replace(/[,.]/g, ''), 10);
    return Math.round(n * mult);
  }
  const fmtCount = (n) => n.toLocaleString(getLang() === 'en' ? 'en-US' : 'de-DE');
  // Das Maximum ist immer der nächste Bonus-Meilenstein (2615 -> 5k). Die Attack-Seite zeigt es
  // nicht an, daher dort daraus berechnet.
  const CHAIN_MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
  const nextMilestone = (cur) => CHAIN_MILESTONES.find((m) => m > cur) || null;

  function readSidebarChain() {
    const bar = findChainBar();
    if (!bar || panel.contains(bar)) return null;
    const valueEl = bar.querySelector('[class*="bar-value"]');
    const timeEl = bar.querySelector('[class*="bar-timeleft"]');
    // Uhrzeit vorher entfernen, damit sie nicht als Teil der Maximal-Zahl gelesen wird
    const rawValue = visibleText(valueEl || bar).replace(/\d{1,2}:\d{2}(?::\d{2})?/g, ' ').replace(/\s+/g, ' ');
    const m = rawValue.match(CHAIN_VALUE_RE);
    let value = valueEl ? rawValue.trim() : '';
    if (m) {
      const cur = parseCount(m[1], m[2]);
      let max = parseCount(m[3], m[4]);
      // Das Maximum ist immer ein Bonus-Meilenstein; alles andere ist falsch gelesen
      if (!CHAIN_MILESTONES.includes(max) || max <= cur) max = nextMilestone(cur);
      value = max ? `${fmtCount(cur)} / ${fmtCount(max)}` : fmtCount(cur);
    }
    const time = timeEl ? timeEl.textContent.trim() : (visibleText(bar).match(/\d{1,2}:\d{2}(?::\d{2})?/) || [''])[0];
    return value || time ? { value, time } : null;
  }

  // Attack-Seite (ohne Sidebar): dort steht die Chain als "2.630 (04:01)", der Timer in
  // <span>(<span>04:01</span>)</span>. Gefundenes Element wird gemerkt, damit nicht 4×/s gesucht wird.
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
    // Chain-Zahl: die Zahl direkt vor "(mm:ss)", bis zu drei Ebenen nach oben gesucht
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
    const chain = show || soundEnabled() ? readChain() : null;
    box.style.display = show && chain ? '' : 'none';
    const left = chain ? parseClock(chain.time) : null;
    updateBomb(left);
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

  // ---- Bomben-Sound 💣: Piepen ab 1:30, ab 0:30 immer schneller, bei 0 Explosion -----------
  // Alles per Web Audio synthetisiert, keine Sounddatei. Browser geben Ton erst nach einem
  // Klick/Tastendruck auf der Seite frei – in Torn klickt man ohnehin ständig.
  const BOMB_FAST_S = 30;      // ab hier wird das Piepen schneller
  const BOMB_LOOKAHEAD = 1.2;  // Pieptöne so weit im Voraus planen (Hintergrund-Tabs ticken nur 1×/s)
  const TAB_ID = Math.random().toString(36).slice(2);
  const soundEnabled = () => GM_getValue('soundOn', false);
  const soundVol = () => GM_getValue('soundVol', 60);
  // Abstand zwischen zwei Pieptönen: 1 s, unter 0:30 gleitend runter auf 0,12 s
  const beepGap = (rem) => (rem > BOMB_FAST_S ? 1 : 0.12 + 0.38 * (rem / BOMB_FAST_S));

  let actx = null;
  let master = null;
  function audio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
      const comp = actx.createDynamicsCompressor(); // verhindert Übersteuern bei der Explosion
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
    pendingBeeps.forEach((o) => { try { o.stop(); } catch { /* schon vorbei */ } });
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
    // Grollen: braunes Rauschen, dessen Filter sich langsam schließt
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
    // Knall: kurzes helles Rauschen
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
    // Druckwelle: tiefer Ton, der nach unten wegrutscht
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
      void panel.offsetWidth; // Animation neu starten
      panel.classList.add('twl-boom');
      setTimeout(() => panel.classList.remove('twl-boom'), 1100);
    }, delayMs);
  }

  // Mehrere Torn-Tabs offen? Nur einer piept – bevorzugt der sichtbare.
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

  // Scharfe Bombe: end = Zeitpunkt von 0:00 (performance.now), shown = zuletzt gelesene Sekunden,
  // next = Audio-Zeit des nächsten geplanten Pieptons
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
    // Timer auf 0 gelaufen (oder Chain-Anzeige verschwunden), während die Bombe tickte
    if (bomb && (left == null || left === 0) && now >= bomb.end - 1500) { detonate(); return; }
    // Kein Timer, schon 0 oder wieder über 1:30 (Hit gelandet): entschärft
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

  // Probehören: die letzten 6 Sekunden + Explosion
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
    if (ctx) beep(ctx.currentTime + 0.05, 0.09); // kurzer Bestätigungs-Piep
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
  const NYAN_SPEED = 170;          // Pixel pro Sekunde entlang des Rahmens
  const NYAN_PAUSE_S = [20, 90];   // zufällige Pause zwischen zwei Runden
  const NYAN_TRAIL = 200;          // Länge des Regenbogenschweifs in Pixeln
  const NYAN_STEP = 3;             // Abstand der Schweif-Stücke (kleiner = glatter)
  const NYAN_CORNER = 16;          // Radius, mit dem die Katze um die Ecken läuft
  const NYAN_TAIL_GAP = 13;        // Abstand Katzenmitte -> Schweifanfang (hinterm Pop-Tart)

  // Der Schweif besteht aus vielen schmalen Regenbogen-Stücken, die einzeln auf der Bahn
  // hinter der Katze liegen – so biegt er sich mit um die Ecken.
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

  // Bahn: Rechteck mit abgerundeten Ecken, innen am Rahmen (damit die Katze am Bildschirmrand
  // nicht abgeschnitten wird), im Uhrzeigersinn ab oben links. at(d) liefert [x, y, Blickrichtung°].
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

  function runNyan() {
    if (!nyanEnabled()) return;
    if (document.hidden) return scheduleNyan();
    const start = performance.now();
    nyan.style.display = trail.style.display = 'block';
    const step = (t) => {
      const path = nyanPath(panel.getBoundingClientRect()); // live, falls das Panel gerade resized wird
      const d = ((t - start) / 1000) * NYAN_SPEED;
      // Eine Runde: Katze läuft bis zum Startpunkt, danach "fließt" der Schweif noch hinterher.
      if (d - NYAN_TAIL_GAP - NYAN_TRAIL >= path.length) {
        nyan.style.display = trail.style.display = 'none';
        scheduleNyan();
        return;
      }

      if (d <= path.length) {
        const [x, y, a] = path.at(d);
        nyan.style.opacity = Math.max(0, Math.min(1, d / 20, (path.length - d) / 20)); // weich ein-/ausblenden
        nyan.style.transform = `translate(${x - 17}px, ${y - 10}px) rotate(${a}deg)`;
      } else {
        nyan.style.opacity = 0;
      }

      const wave = Math.floor(t / 150) % 2; // Regenbogen wippt stufenweise wie im Original
      trailParts.forEach((el, k) => {
        const dk = d - NYAN_TAIL_GAP - k * NYAN_STEP;
        if (dk < 0 || dk > path.length) {
          el.style.opacity = 0;
          return;
        }
        const [x, y, a] = path.at(dk);
        const rad = (a * Math.PI) / 180;
        const off = (Math.floor((k * NYAN_STEP) / 12) + wave) % 2 ? 1 : -1; // quer zur Laufrichtung
        el.style.opacity = 1 - (k / trailParts.length) ** 2; // Schweifende blendet aus
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
    if (nyanEnabled()) scheduleNyan(800); // beim Einschalten gleich eine Runde
  }
  nyanToggle.addEventListener('change', () => {
    GM_setValue('nyan', nyanToggle.checked);
    applyNyan();
  });

  // ---- Export / Import der Einstellungen (inkl. API-Key, Spieler, Factions) -----------------
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
    // Spieler und Factions in die erwartete Form bringen, kaputte Einträge verwerfen
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
    if (keyChanged) GM_setValue('hits', null); // Hits gehören zum alten Account
    GM_setValue('hitsDeniedKey', '');
    GM_setValue('lastRefresh', 0);
    saveBackup(); // sofort sichern, nicht erst nach der Verzögerung

    // Alles sofort übernehmen
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

  // Änderungen aus anderen Tabs übernehmen
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
  render();
  refreshAll(false);
  scheduleNyan();
  updateChain();
  setInterval(updateChain, 250); // öfter als 1×/s, damit die Anzeige nicht hinter Torns Timer herhinkt

  // Jede Sekunde: Zeiten/Farben neu berechnen; alle paar Sekunden prüfen, ob ein API-Refresh fällig ist.
  let tick = 0;
  setInterval(() => {
    render();
    if (++tick % 5 === 0) refreshAll(false);
  }, 1000);
})();
