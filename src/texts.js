// -----------------------------------------------------------------------------
// Every text the integration shows, in the four languages of the Gladys
// interface: English, French, German (with "du") and Spanish (with "usted").
// test/i18n.test.js checks that none is missing, empty or too long. The words
// follow the Gladys interface (front/src/config/i18n): Découverte, Entdecken,
// Descubrir… Brand names are not translated.
// -----------------------------------------------------------------------------

/** The text of a multi-language object in a language, English otherwise. */
export const pick = (texts, language) => texts?.[language] ?? texts?.en ?? '';

/** A multi-language object from a function of the language. */
export const localized = (fn) => ({ en: fn('en'), fr: fn('fr'), de: fn('de'), es: fn('es') });

// Names of the features, fixed by Gladys when the device is added.
export const FEATURE_NAMES = {
  en: {
    state: 'Alarm state',
    online: 'Online',
    power: 'Mains power',
    backup_battery: 'Backup battery',
    alerts: 'Alerts',
    contact: 'Opening',
    motion: 'Motion',
    glass_break: 'Glass break',
    smoke: 'Smoke',
    co: 'Carbon monoxide',
    leak: 'Water leak',
    temperature: 'Temperature',
    freeze: 'Temperature alert',
    tamper: 'Tamper',
    battery_low: 'Low battery',
    lock: 'Lock',
    lock_state: 'Lock state',
    keypad_battery_low: 'Low keypad battery',
    image: 'Picture',
    ring: 'Doorbell',
  },
  fr: {
    state: "État de l'alarme",
    online: 'En ligne',
    power: 'Alimentation secteur',
    backup_battery: 'Batterie de secours',
    alerts: 'Alertes',
    contact: 'Ouverture',
    motion: 'Mouvement',
    glass_break: 'Bris de vitre',
    smoke: 'Fumée',
    co: 'Monoxyde de carbone',
    leak: "Fuite d'eau",
    temperature: 'Température',
    freeze: 'Alerte température',
    tamper: 'Sabotage',
    battery_low: 'Pile faible',
    lock: 'Verrouillage',
    lock_state: 'État de la serrure',
    keypad_battery_low: 'Pile du clavier faible',
    image: 'Image',
    ring: 'Sonnette',
  },
  de: {
    state: 'Alarmstatus',
    online: 'Online',
    power: 'Netzstrom',
    backup_battery: 'Notstrombatterie',
    alerts: 'Meldungen',
    contact: 'Öffnung',
    motion: 'Bewegung',
    glass_break: 'Glasbruch',
    smoke: 'Rauch',
    co: 'Kohlenmonoxid',
    leak: 'Wasserleck',
    temperature: 'Temperatur',
    freeze: 'Temperaturalarm',
    tamper: 'Manipulation',
    battery_low: 'Batterie schwach',
    lock: 'Verriegelung',
    lock_state: 'Schlossstatus',
    keypad_battery_low: 'Tastenfeld-Batterie schwach',
    image: 'Bild',
    ring: 'Türklingel',
  },
  es: {
    state: 'Estado de la alarma',
    online: 'En línea',
    power: 'Alimentación de red',
    backup_battery: 'Batería de respaldo',
    alerts: 'Alertas',
    contact: 'Apertura',
    motion: 'Movimiento',
    glass_break: 'Rotura de cristal',
    smoke: 'Humo',
    co: 'Monóxido de carbono',
    leak: 'Fuga de agua',
    temperature: 'Temperatura',
    freeze: 'Alerta de temperatura',
    tamper: 'Manipulación',
    battery_low: 'Batería baja',
    lock: 'Bloqueo',
    lock_state: 'Estado de la cerradura',
    keypad_battery_low: 'Batería baja del teclado',
    image: 'Imagen',
    ring: 'Timbre',
  },
};

// What a device is, appended to the name the user gave it in the app.
export const KIND_NAMES = {
  en: {
    system: 'SimpliSafe alarm',
    entry: 'Entry sensor',
    motion: 'Motion sensor',
    glass_break: 'Glass break sensor',
    smoke: 'Smoke detector',
    co: 'CO detector',
    smoke_co: 'Smoke and CO detector',
    leak: 'Water sensor',
    freeze: 'Freeze sensor',
    keypad: 'Keypad',
    keychain: 'Key fob',
    panic_button: 'Panic button',
    siren: 'Siren',
    lock: 'Smart Lock',
    camera: 'SimpliCam',
    doorbell: 'Video Doorbell',
    outdoor: 'Outdoor camera',
  },
  fr: {
    system: 'Alarme SimpliSafe',
    entry: "Détecteur d'ouverture",
    motion: 'Détecteur de mouvement',
    glass_break: 'Détecteur de bris de vitre',
    smoke: 'Détecteur de fumée',
    co: 'Détecteur de CO',
    smoke_co: 'Détecteur de fumée et CO',
    leak: "Détecteur de fuite d'eau",
    freeze: 'Détecteur de gel',
    keypad: 'Clavier',
    keychain: 'Télécommande',
    panic_button: 'Bouton panique',
    siren: 'Sirène',
    lock: 'Smart Lock',
    camera: 'SimpliCam',
    doorbell: 'Sonnette vidéo',
    outdoor: 'Caméra extérieure',
  },
  de: {
    system: 'SimpliSafe-Alarmanlage',
    entry: 'Öffnungsmelder',
    motion: 'Bewegungsmelder',
    glass_break: 'Glasbruchmelder',
    smoke: 'Rauchmelder',
    co: 'CO-Melder',
    smoke_co: 'Rauch- und CO-Melder',
    leak: 'Wassermelder',
    freeze: 'Frostmelder',
    keypad: 'Tastenfeld',
    keychain: 'Fernbedienung',
    panic_button: 'Paniktaste',
    siren: 'Sirene',
    lock: 'Smart Lock',
    camera: 'SimpliCam',
    doorbell: 'Video-Türklingel',
    outdoor: 'Außenkamera',
  },
  es: {
    system: 'Alarma SimpliSafe',
    entry: 'Sensor de apertura',
    motion: 'Sensor de movimiento',
    glass_break: 'Sensor de rotura de cristal',
    smoke: 'Detector de humo',
    co: 'Detector de CO',
    smoke_co: 'Detector de humo y CO',
    leak: 'Sensor de agua',
    freeze: 'Sensor de helada',
    keypad: 'Teclado',
    keychain: 'Mando',
    panic_button: 'Botón de pánico',
    siren: 'Sirena',
    lock: 'Smart Lock',
    camera: 'SimpliCam',
    doorbell: 'Timbre con vídeo',
    outdoor: 'Cámara exterior',
  },
};

// Labels of the alarm states (the values stay in English).
export const STATE_NAMES = {
  en: {
    off: 'Disarmed',
    home: 'Armed home',
    away: 'Armed away',
    exit_delay: 'Exit delay',
    entry_delay: 'Entry delay',
    alarm: 'Alarm',
  },
  fr: {
    off: 'Désarmée',
    home: 'Armée (maison)',
    away: 'Armée (absent)',
    exit_delay: 'Délai de sortie',
    entry_delay: "Délai d'entrée",
    alarm: 'Alarme en cours',
  },
  de: {
    off: 'Unscharf',
    home: 'Scharf (zu Hause)',
    away: 'Scharf (abwesend)',
    exit_delay: 'Ausgangsverzögerung',
    entry_delay: 'Eingangsverzögerung',
    alarm: 'Alarm ausgelöst',
  },
  es: {
    off: 'Desarmada',
    home: 'Armada (en casa)',
    away: 'Armada (ausente)',
    exit_delay: 'Retardo de salida',
    entry_delay: 'Retardo de entrada',
    alarm: 'Alarma en curso',
  },
};

// The modes a command sets (widget buttons, scene action).
export const MODE_NAMES = {
  en: { off: 'Disarm', home: 'Arm home', away: 'Arm away' },
  fr: { off: 'Désarmer', home: 'Armer (maison)', away: 'Armer (absent)' },
  de: { off: 'Unscharf schalten', home: 'Scharf (zu Hause)', away: 'Scharf (abwesend)' },
  es: { off: 'Desarmar', home: 'Armar (en casa)', away: 'Armar (ausente)' },
};

/** The value of the "Alerts" feature when SimpliSafe lists none. */
export const NO_ALERT = {
  en: 'No alert',
  fr: 'Aucune alerte',
  de: 'Keine Meldung',
  es: 'Ninguna alerta',
};

/** Connection status of the Configuration screen. */
export const CONNECTION_TEXT = {
  notSignedIn: {
    en: 'Not signed in: click Connect, then use the “Finish the sign-in” action.',
    fr: 'Non connecté : cliquez sur Connecter, puis utilisez l’action « Terminer la connexion ».',
    de: 'Nicht angemeldet: Klicke auf Verbinden und nutze dann die Aktion „Anmeldung abschließen“.',
    es: 'Sin sesión: pulse Conectar y luego use la acción «Terminar el inicio de sesión».',
  },
  authExpired: {
    en: 'SimpliSafe refused the saved sign-in (password changed?): sign in again.',
    fr: 'SimpliSafe a refusé la connexion enregistrée (mot de passe changé ?) : reconnectez-vous.',
    de: 'SimpliSafe hat die gespeicherte Anmeldung abgelehnt (Passwort geändert?): Melde dich neu an.',
    es: 'SimpliSafe rechazó la sesión guardada (¿cambió la contraseña?): inicie sesión de nuevo.',
  },
  rateLimited: {
    en: 'SimpliSafe is refusing requests for now (too many?): the integration waits and retries.',
    fr: 'SimpliSafe refuse les requêtes pour l’instant (trop nombreuses ?) : l’intégration attend et réessaie.',
    de: 'SimpliSafe lehnt Anfragen gerade ab (zu viele?): Die Integration wartet und versucht es erneut.',
    es: 'SimpliSafe rechaza las peticiones por ahora (¿demasiadas?): la integración espera y reintenta.',
  },
  unreachable: {
    en: 'The SimpliSafe cloud cannot be reached: the integration retries.',
    fr: 'Le cloud SimpliSafe est injoignable : l’intégration réessaie.',
    de: 'Die SimpliSafe-Cloud ist nicht erreichbar: Die Integration versucht es erneut.',
    es: 'No se puede acceder a la nube de SimpliSafe: la integración lo reintenta.',
  },
  noSystem: {
    en: 'Signed in, but the account has no SimpliSafe 3 system with a base station.',
    fr: 'Connecté, mais le compte n’a aucun système SimpliSafe 3 avec base.',
    de: 'Angemeldet, aber das Konto hat kein SimpliSafe-3-System mit Basisstation.',
    es: 'Sesión iniciada, pero la cuenta no tiene ningún sistema SimpliSafe 3 con base.',
  },
};

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: 'L’initialisation a échoué, consultez les journaux de l’intégration.',
  de: 'Die Initialisierung ist fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización falló, consulte los registros de la integración.',
};

/** Messages of the actions and commands (shown under a button, or as a toast). */
export const MESSAGES = {
  starting: {
    en: 'The integration is starting, try again in a few seconds.',
    fr: 'L’intégration démarre, réessayez dans quelques secondes.',
    de: 'Die Integration startet, versuche es in ein paar Sekunden erneut.',
    es: 'La integración se está iniciando, inténtelo de nuevo en unos segundos.',
  },
  codeFormat: {
    en: 'No code found: paste the com.simplisafe.mobile://… address that contains code=.',
    fr: 'Aucun code trouvé : collez l’adresse com.simplisafe.mobile://… qui contient code=.',
    de: 'Kein Code gefunden: Füge die Adresse com.simplisafe.mobile://… ein, die code= enthält.',
    es: 'No se encontró ningún código: pegue la dirección com.simplisafe.mobile://… que contiene code=.',
  },
  noFlow: {
    en: 'Click Connect first: the code only works with the sign-in page opened by Gladys.',
    fr: 'Cliquez d’abord sur Connecter : le code ne vaut que pour la page ouverte par Gladys.',
    de: 'Klicke zuerst auf Verbinden: Der Code gilt nur für die von Gladys geöffnete Seite.',
    es: 'Pulse primero Conectar: el código solo sirve con la página abierta por Gladys.',
  },
  badCode: {
    en: 'SimpliSafe refused the code (used, expired, or from another Connect): click Connect again.',
    fr: 'SimpliSafe a refusé le code (déjà utilisé, expiré ou d’un autre Connecter) : recliquez sur Connecter.',
    de: 'SimpliSafe hat den Code abgelehnt (benutzt, abgelaufen oder anderes Verbinden): Klicke erneut auf Verbinden.',
    es: 'SimpliSafe rechazó el código (usado, caducado o de otro Conectar): pulse Conectar de nuevo.',
  },
  notSignedIn: {
    en: 'Not signed in to SimpliSafe yet.',
    fr: 'Pas encore connecté à SimpliSafe.',
    de: 'Noch nicht bei SimpliSafe angemeldet.',
    es: 'Todavía no ha iniciado sesión en SimpliSafe.',
  },
  signedOut: {
    en: 'Signed out: the tokens are deleted. The devices stay, without new readings.',
    fr: 'Déconnecté : les jetons sont supprimés. Les appareils restent, sans nouveau relevé.',
    de: 'Abgemeldet: Die Token sind gelöscht. Die Geräte bleiben, ohne neue Werte.',
    es: 'Sesión cerrada: los tokens se han borrado. Los dispositivos se mantienen, sin nuevas lecturas.',
  },
  controlOff: {
    en: 'Arming from Gladys is turned off in the configuration.',
    fr: 'L’armement depuis Gladys est désactivé dans la configuration.',
    de: 'Das Scharfschalten über Gladys ist in der Konfiguration deaktiviert.',
    es: 'El armado desde Gladys está desactivado en la configuración.',
  },
  disarmOff: {
    en: 'Disarming from Gladys is turned off in the configuration.',
    fr: 'Le désarmement depuis Gladys est désactivé dans la configuration.',
    de: 'Das Unscharfschalten über Gladys ist in der Konfiguration deaktiviert.',
    es: 'El desarmado desde Gladys está desactivado en la configuración.',
  },
  unlockOff: {
    en: 'Unlocking from Gladys is turned off in the configuration.',
    fr: 'Le déverrouillage depuis Gladys est désactivé dans la configuration.',
    de: 'Das Entriegeln über Gladys ist in der Konfiguration deaktiviert.',
    es: 'El desbloqueo desde Gladys está desactivado en la configuración.',
  },
  unknownDevice: {
    en: 'This SimpliSafe device is no longer in the account.',
    fr: 'Cet appareil SimpliSafe n’est plus dans le compte.',
    de: 'Dieses SimpliSafe-Gerät ist nicht mehr im Konto.',
    es: 'Este dispositivo SimpliSafe ya no está en la cuenta.',
  },
  chooseSystem: {
    en: 'The account has several systems: choose one.',
    fr: 'Le compte a plusieurs systèmes : choisissez-en un.',
    de: 'Das Konto hat mehrere Systeme: Wähle eines aus.',
    es: 'La cuenta tiene varios sistemas: elija uno.',
  },
  noRemote: {
    en: 'The SimpliSafe plan of this system does not allow remote control.',
    fr: 'L’abonnement SimpliSafe de ce système ne permet pas le pilotage à distance.',
    de: 'Das SimpliSafe-Abo dieses Systems erlaubt keine Fernsteuerung.',
    es: 'El plan de SimpliSafe de este sistema no permite el control remoto.',
  },
  rateLimited: {
    en: 'SimpliSafe is refusing requests for now: try again in a few minutes.',
    fr: 'SimpliSafe refuse les requêtes pour l’instant : réessayez dans quelques minutes.',
    de: 'SimpliSafe lehnt Anfragen gerade ab: Versuche es in ein paar Minuten erneut.',
    es: 'SimpliSafe rechaza las peticiones por ahora: inténtelo de nuevo en unos minutos.',
  },
  busy: {
    en: 'The base station is busy syncing: try again in a moment.',
    fr: 'La base est en cours de synchronisation : réessayez dans un instant.',
    de: 'Die Basisstation synchronisiert gerade: Versuche es gleich noch einmal.',
    es: 'La base se está sincronizando: inténtelo de nuevo en un momento.',
  },
  unreachable: {
    en: 'The SimpliSafe cloud cannot be reached.',
    fr: 'Le cloud SimpliSafe est injoignable.',
    de: 'Die SimpliSafe-Cloud ist nicht erreichbar.',
    es: 'No se puede acceder a la nube de SimpliSafe.',
  },
  failed: {
    en: 'SimpliSafe refused the command.',
    fr: 'SimpliSafe a refusé la commande.',
    de: 'SimpliSafe hat den Befehl abgelehnt.',
    es: 'SimpliSafe rechazó la orden.',
  },
  noImage: {
    en: 'No picture yet: SimpliSafe sends one with each motion or ring.',
    fr: 'Pas encore d’image : SimpliSafe en envoie une à chaque mouvement ou sonnerie.',
    de: 'Noch kein Bild: SimpliSafe schickt bei jeder Bewegung oder jedem Klingeln eines.',
    es: 'Todavía no hay imagen: SimpliSafe envía una con cada movimiento o timbrazo.',
  },
};

/** The answer of a successful command (toast of the widget, action message). */
export function commandDone(mode) {
  return localized((lang) => `${pick(MODE_NAMES, lang)[mode]} ✓`);
}

/** Report of a successful sign-in or connection test. */
export function connectedReport({ systems, devices }) {
  const names = systems.join(', ');
  return {
    en: `Connected: ${systems.length} system(s) (${names}), ${devices} device(s). Add them in the Discover tab.`,
    fr: `Connecté : ${systems.length} système(s) (${names}), ${devices} appareil(s). Ajoutez-les depuis l’onglet Découverte.`,
    de: `Verbunden: ${systems.length} System(e) (${names}), ${devices} Gerät(e). Füge sie im Tab Entdecken hinzu.`,
    es: `Conectado: ${systems.length} sistema(s) (${names}), ${devices} dispositivo(s). Añádalos en la pestaña Descubrir.`,
  };
}
