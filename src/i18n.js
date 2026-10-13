// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface. German says "du", Spanish says "usted" (maintainer's choice for
// all his integrations). Vocabulary of the Gladys front-end where it exists
// (front/src/config/i18n: vacuum-cleaner states, "Retour à la base"...).
// Logs and the diagnostic stay in English: they are pasted on the forum.
// -----------------------------------------------------------------------------

import { pickLanguage } from './config.js';

const plural = (count, one, many) => (count === 1 ? one : many);

export const TEXTS = {
  en: {
    features: {
      state: 'State',
      'run-mode': 'Cleaning',
      dock: 'Return to dock',
      pause: 'Pause',
      locate: 'Locate',
      battery: 'Battery',
      charging: 'Charging',
      'bin-full': 'Bin full',
      'mission-duration': 'Mission duration',
      'mission-area': 'Mission area',
      error: 'Error',
    },
    runModes: { idle: 'Idle', cleaning: 'Clean' },
    states: ['Stopped', 'Running', 'Paused', 'Error', 'Returning to dock', 'Charging', 'Docked'],
    widget: {
      state: 'State',
      battery: 'Battery',
      bin: 'Bin',
      binOk: 'OK',
      binFull: 'Full',
      mission: 'Mission',
      lastMission: 'Last mission',
      error: 'Error',
      connection: 'Connection',
      start: 'Start',
      pause: 'Pause',
      resume: 'Resume',
      stop: 'Stop',
      dock: 'Dock',
      pickRobot: 'Pick a robot in the widget settings.',
      unknownRobot: 'This robot is not known to the integration any more: add it again.',
    },
    status: {
      connected: 'Connected',
      connecting: 'Connecting…',
      busy: 'Busy (iRobot app?)',
      auth: 'Password refused',
      unreachable: 'Not answering',
      stopped: 'Not connected',
    },
    transport: {
      busy: 'The robot turns the connection away: the iRobot app (or another local client) may hold it, or the robot is restarting. Retrying.',
      auth: 'The robot refused its password: add it again (Configuration, “Add a robot”).',
      unreachable: 'The robot does not answer on the network: Wi-Fi, address or power. Retrying.',
    },
    toast: {
      start: 'Cleaning started',
      pause: 'Paused',
      resume: 'Cleaning resumed',
      stop: 'Stopped',
      dock: 'Going back to the dock',
      notConnected: 'The robot is not connected.',
    },
    outcomes: { completed: 'Completed', stopped: 'Stopped' },
    actions: {
      missingIp: 'Enter the IP address of the robot.',
      noAnswer: (ip) =>
        `Nothing answered the iRobot discovery query at ${ip}: check the address (router, iRobot app), or enter the BLID too.`,
      cloudOnly:
        'This robot only gives its password through the iRobot cloud: use “Get the passwords from the iRobot cloud”.',
      noPassword:
        'The robot did not give its password. Put it on its home base, hold HOME (DOCK + SPOT on some 600 series) until it plays a tune, then start this action again within a few seconds. Close the iRobot app first.',
      added: (name, verified) =>
        verified
          ? `${name} added and connected. Add it to Gladys from the Discovery tab.`
          : `${name} added, but the connection could not be checked now (iRobot app open?). Add it to Gladys from the Discovery tab: the integration keeps trying.`,
      authFailed: (name) =>
        `${name}: the robot refused this password. Check it, or leave the password empty to read it from the robot.`,
      cloudCredentials: 'The iRobot account refused this email or password.',
      cloudNetwork:
        'The iRobot cloud could not be reached. Try again later, or use the HOME button method.',
      cloudUnexpected:
        'The iRobot cloud gave an unexpected answer. Try again later, or use the HOME button method.',
      cloudNoRobot: 'This iRobot account has no robot.',
      cloudDone: (total, located, names) =>
        `${total} ${plural(total, 'robot', 'robots')} found in the account (${names}), ${located} located on the network.` +
        (located < total
          ? ' For the others, run “Add a robot” with their IP address (the password is already known).'
          : ' Add them to Gladys from the Discovery tab.'),
      forgotten: (name) =>
        `${name}: credentials deleted, connection closed. Delete the device in Gladys too if you no longer want it.`,
      unknownDevice: 'This device is not a robot of the integration.',
      noRobot: 'No robot yet: use “Add a robot” or “Get the passwords from the iRobot cloud”.',
    },
  },
  fr: {
    features: {
      state: 'État',
      'run-mode': 'Nettoyage',
      dock: 'Retour à la base',
      pause: 'Pause',
      locate: 'Localiser',
      battery: 'Batterie',
      charging: 'En charge',
      'bin-full': 'Bac plein',
      'mission-duration': 'Durée de la mission',
      'mission-area': 'Surface de la mission',
      error: 'Erreur',
    },
    runModes: { idle: 'Repos', cleaning: 'Nettoyer' },
    states: [
      'Arrêté',
      'En cours',
      'En pause',
      'Erreur',
      'Retour à la base',
      'En charge',
      'Sur la base',
    ],
    widget: {
      state: 'État',
      battery: 'Batterie',
      bin: 'Bac',
      binOk: 'OK',
      binFull: 'Plein',
      mission: 'Mission',
      lastMission: 'Dernière mission',
      error: 'Erreur',
      connection: 'Connexion',
      start: 'Démarrer',
      pause: 'Pause',
      resume: 'Reprendre',
      stop: 'Arrêter',
      dock: 'Retour base',
      pickRobot: 'Choisissez un robot dans les réglages du widget.',
      unknownRobot: 'Ce robot n’est plus connu de l’intégration : ajoutez-le à nouveau.',
    },
    status: {
      connected: 'Connecté',
      connecting: 'Connexion…',
      busy: 'Occupé (appli iRobot ?)',
      auth: 'Mot de passe refusé',
      unreachable: 'Ne répond pas',
      stopped: 'Non connecté',
    },
    transport: {
      busy: 'Le robot refuse la connexion : l’appli iRobot (ou un autre client local) l’occupe peut-être, ou il redémarre. Nouvel essai bientôt.',
      auth: 'Le robot a refusé son mot de passe : ajoutez-le à nouveau (Configuration, « Ajouter un robot »).',
      unreachable:
        'Le robot ne répond pas sur le réseau : Wi-Fi, adresse ou alimentation. Nouvel essai bientôt.',
    },
    toast: {
      start: 'Nettoyage lancé',
      pause: 'En pause',
      resume: 'Nettoyage repris',
      stop: 'Arrêté',
      dock: 'Retour à la base',
      notConnected: 'Le robot n’est pas connecté.',
    },
    outcomes: { completed: 'Terminée', stopped: 'Interrompue' },
    actions: {
      missingIp: 'Saisissez l’adresse IP du robot.',
      noAnswer: (ip) =>
        `Rien n’a répondu à la requête de découverte iRobot sur ${ip} : vérifiez l’adresse (box, appli iRobot), ou saisissez aussi le BLID.`,
      cloudOnly:
        'Ce robot ne donne son mot de passe que par le cloud iRobot : utilisez « Récupérer les mots de passe depuis le cloud iRobot ».',
      noPassword:
        'Le robot n’a pas donné son mot de passe. Posez-le sur sa base, maintenez HOME (DOCK + SPOT sur certains 600) jusqu’à la mélodie, puis relancez cette action dans les secondes qui suivent. Fermez d’abord l’appli iRobot.',
      added: (name, verified) =>
        verified
          ? `${name} ajouté et connecté. Ajoutez-le à Gladys depuis l’onglet Découverte.`
          : `${name} ajouté, mais la connexion n’a pas pu être vérifiée maintenant (appli iRobot ouverte ?). Ajoutez-le à Gladys depuis l’onglet Découverte : l’intégration réessaie.`,
      authFailed: (name) =>
        `${name} : le robot a refusé ce mot de passe. Vérifiez-le, ou laissez le mot de passe vide pour le lire sur le robot.`,
      cloudCredentials: 'Le compte iRobot a refusé cet e-mail ou ce mot de passe.',
      cloudNetwork:
        'Le cloud iRobot est injoignable. Réessayez plus tard, ou utilisez la méthode du bouton HOME.',
      cloudUnexpected:
        'Le cloud iRobot a donné une réponse inattendue. Réessayez plus tard, ou utilisez la méthode du bouton HOME.',
      cloudNoRobot: 'Ce compte iRobot n’a aucun robot.',
      cloudDone: (total, located, names) =>
        `${total} robot${plural(total, '', 's')} trouvé${plural(total, '', 's')} dans le compte (${names}), ${located} localisé${plural(located, '', 's')} sur le réseau.` +
        (located < total
          ? ' Pour les autres, lancez « Ajouter un robot » avec leur adresse IP (le mot de passe est déjà connu).'
          : ' Ajoutez-les à Gladys depuis l’onglet Découverte.'),
      forgotten: (name) =>
        `${name} : identifiants supprimés, connexion fermée. Supprimez aussi l’appareil dans Gladys si vous n’en voulez plus.`,
      unknownDevice: 'Cet appareil n’est pas un robot de l’intégration.',
      noRobot:
        'Aucun robot pour l’instant : utilisez « Ajouter un robot » ou « Récupérer les mots de passe depuis le cloud iRobot ».',
    },
  },
  de: {
    features: {
      state: 'Status',
      'run-mode': 'Reinigung',
      dock: 'Zurück zur Ladestation',
      pause: 'Pause',
      locate: 'Finden',
      battery: 'Akku',
      charging: 'Lädt',
      'bin-full': 'Behälter voll',
      'mission-duration': 'Einsatzdauer',
      'mission-area': 'Gereinigte Fläche',
      error: 'Fehler',
    },
    runModes: { idle: 'Leerlauf', cleaning: 'Reinigen' },
    states: [
      'Gestoppt',
      'Läuft',
      'Pausiert',
      'Fehler',
      'Kehrt zur Ladestation zurück',
      'Lädt',
      'Angedockt',
    ],
    widget: {
      state: 'Status',
      battery: 'Akku',
      bin: 'Behälter',
      binOk: 'OK',
      binFull: 'Voll',
      mission: 'Einsatz',
      lastMission: 'Letzter Einsatz',
      error: 'Fehler',
      connection: 'Verbindung',
      start: 'Starten',
      pause: 'Pause',
      resume: 'Fortsetzen',
      stop: 'Stoppen',
      dock: 'Zur Station',
      pickRobot: 'Wähle in den Widget-Einstellungen einen Roboter aus.',
      unknownRobot: 'Die Integration kennt diesen Roboter nicht mehr: Füge ihn erneut hinzu.',
    },
    status: {
      connected: 'Verbunden',
      connecting: 'Verbindet…',
      busy: 'Belegt (iRobot-App?)',
      auth: 'Passwort abgelehnt',
      unreachable: 'Antwortet nicht',
      stopped: 'Nicht verbunden',
    },
    transport: {
      busy: 'Der Roboter weist die Verbindung ab: Die iRobot-App (oder ein anderer lokaler Client) belegt ihn vielleicht, oder er startet neu. Neuer Versuch folgt.',
      auth: 'Der Roboter hat sein Passwort abgelehnt: Füge ihn erneut hinzu (Konfiguration, „Roboter hinzufügen“).',
      unreachable:
        'Der Roboter antwortet nicht im Netzwerk: WLAN, Adresse oder Stromversorgung. Neuer Versuch folgt.',
    },
    toast: {
      start: 'Reinigung gestartet',
      pause: 'Pausiert',
      resume: 'Reinigung fortgesetzt',
      stop: 'Gestoppt',
      dock: 'Fährt zur Ladestation',
      notConnected: 'Der Roboter ist nicht verbunden.',
    },
    outcomes: { completed: 'Abgeschlossen', stopped: 'Abgebrochen' },
    actions: {
      missingIp: 'Gib die IP-Adresse des Roboters ein.',
      noAnswer: (ip) =>
        `Auf ${ip} hat nichts auf die iRobot-Suchanfrage geantwortet: Prüfe die Adresse (Router, iRobot-App) oder gib auch die BLID ein.`,
      cloudOnly:
        'Dieser Roboter gibt sein Passwort nur über die iRobot-Cloud heraus: Nutze „Passwörter aus der iRobot-Cloud holen“.',
      noPassword:
        'Der Roboter hat sein Passwort nicht herausgegeben. Stelle ihn auf die Ladestation, halte HOME (bei manchen 600ern DOCK + SPOT) gedrückt, bis er eine Melodie spielt, und starte diese Aktion innerhalb weniger Sekunden erneut. Schließe vorher die iRobot-App.',
      added: (name, verified) =>
        verified
          ? `${name} hinzugefügt und verbunden. Füge ihn im Tab „Entdecken“ zu Gladys hinzu.`
          : `${name} hinzugefügt, aber die Verbindung konnte gerade nicht geprüft werden (iRobot-App offen?). Füge ihn im Tab „Entdecken“ zu Gladys hinzu: Die Integration versucht es weiter.`,
      authFailed: (name) =>
        `${name}: Der Roboter hat dieses Passwort abgelehnt. Prüfe es oder lass das Passwort leer, um es vom Roboter zu lesen.`,
      cloudCredentials: 'Das iRobot-Konto hat diese E-Mail-Adresse oder dieses Passwort abgelehnt.',
      cloudNetwork:
        'Die iRobot-Cloud ist nicht erreichbar. Versuche es später erneut oder nutze die Methode mit der HOME-Taste.',
      cloudUnexpected:
        'Die iRobot-Cloud hat unerwartet geantwortet. Versuche es später erneut oder nutze die Methode mit der HOME-Taste.',
      cloudNoRobot: 'Dieses iRobot-Konto hat keinen Roboter.',
      cloudDone: (total, located, names) =>
        `${total} ${plural(total, 'Roboter', 'Roboter')} im Konto gefunden (${names}), ${located} im Netzwerk gefunden.` +
        (located < total
          ? ' Starte für die anderen „Roboter hinzufügen“ mit ihrer IP-Adresse (das Passwort ist schon bekannt).'
          : ' Füge sie im Tab „Entdecken“ zu Gladys hinzu.'),
      forgotten: (name) =>
        `${name}: Zugangsdaten gelöscht, Verbindung geschlossen. Lösche auch das Gerät in Gladys, wenn du es nicht mehr brauchst.`,
      unknownDevice: 'Dieses Gerät ist kein Roboter der Integration.',
      noRobot:
        'Noch kein Roboter: Nutze „Roboter hinzufügen“ oder „Passwörter aus der iRobot-Cloud holen“.',
    },
  },
  es: {
    features: {
      state: 'Estado',
      'run-mode': 'Limpieza',
      dock: 'Volver a la base',
      pause: 'Pausa',
      locate: 'Localizar',
      battery: 'Batería',
      charging: 'Cargando',
      'bin-full': 'Depósito lleno',
      'mission-duration': 'Duración de la limpieza',
      'mission-area': 'Superficie limpiada',
      error: 'Error',
    },
    runModes: { idle: 'Inactivo', cleaning: 'Limpiar' },
    states: [
      'Detenido',
      'En marcha',
      'En pausa',
      'Error',
      'Volviendo a la base',
      'Cargando',
      'En la base',
    ],
    widget: {
      state: 'Estado',
      battery: 'Batería',
      bin: 'Depósito',
      binOk: 'OK',
      binFull: 'Lleno',
      mission: 'Limpieza',
      lastMission: 'Última limpieza',
      error: 'Error',
      connection: 'Conexión',
      start: 'Iniciar',
      pause: 'Pausa',
      resume: 'Reanudar',
      stop: 'Detener',
      dock: 'A la base',
      pickRobot: 'Elija un robot en los ajustes del widget.',
      unknownRobot: 'La integración ya no conoce este robot: añádalo de nuevo.',
    },
    status: {
      connected: 'Conectado',
      connecting: 'Conectando…',
      busy: 'Ocupado (¿app iRobot?)',
      auth: 'Contraseña rechazada',
      unreachable: 'No responde',
      stopped: 'No conectado',
    },
    transport: {
      busy: 'El robot rechaza la conexión: puede que la app iRobot (u otro cliente local) lo esté usando, o que se esté reiniciando. Se volverá a intentar.',
      auth: 'El robot ha rechazado su contraseña: añádalo de nuevo (Configuración, «Añadir un robot»).',
      unreachable:
        'El robot no responde en la red: wifi, dirección o alimentación. Se volverá a intentar.',
    },
    toast: {
      start: 'Limpieza iniciada',
      pause: 'En pausa',
      resume: 'Limpieza reanudada',
      stop: 'Detenido',
      dock: 'Volviendo a la base',
      notConnected: 'El robot no está conectado.',
    },
    outcomes: { completed: 'Terminada', stopped: 'Interrumpida' },
    actions: {
      missingIp: 'Introduzca la dirección IP del robot.',
      noAnswer: (ip) =>
        `Nada ha respondido a la consulta de descubrimiento iRobot en ${ip}: compruebe la dirección (router, app iRobot) o introduzca también el BLID.`,
      cloudOnly:
        'Este robot solo da su contraseña a través de la nube iRobot: use «Obtener las contraseñas de la nube iRobot».',
      noPassword:
        'El robot no ha dado su contraseña. Colóquelo en su base, mantenga pulsado HOME (DOCK + SPOT en algunos 600) hasta que suene una melodía y vuelva a lanzar esta acción en los segundos siguientes. Cierre antes la app iRobot.',
      added: (name, verified) =>
        verified
          ? `${name} añadido y conectado. Añádalo a Gladys desde la pestaña Descubrimiento.`
          : `${name} añadido, pero no se ha podido comprobar la conexión ahora (¿app iRobot abierta?). Añádalo a Gladys desde la pestaña Descubrimiento: la integración sigue intentándolo.`,
      authFailed: (name) =>
        `${name}: el robot ha rechazado esta contraseña. Compruébela, o deje la contraseña vacía para leerla en el robot.`,
      cloudCredentials: 'La cuenta iRobot ha rechazado este correo electrónico o esta contraseña.',
      cloudNetwork:
        'No se puede acceder a la nube iRobot. Inténtelo más tarde, o use el método del botón HOME.',
      cloudUnexpected:
        'La nube iRobot ha dado una respuesta inesperada. Inténtelo más tarde, o use el método del botón HOME.',
      cloudNoRobot: 'Esta cuenta iRobot no tiene ningún robot.',
      cloudDone: (total, located, names) =>
        `${total} robot${plural(total, '', 's')} en la cuenta (${names}), ${located} localizado${plural(located, '', 's')} en la red.` +
        (located < total
          ? ' Para los demás, lance «Añadir un robot» con su dirección IP (la contraseña ya se conoce).'
          : ' Añádalos a Gladys desde la pestaña Descubrimiento.'),
      forgotten: (name) =>
        `${name}: credenciales eliminadas, conexión cerrada. Elimine también el dispositivo en Gladys si ya no lo quiere.`,
      unknownDevice: 'Este dispositivo no es un robot de la integración.',
      noRobot:
        'Todavía no hay ningún robot: use «Añadir un robot» u «Obtener las contraseñas de la nube iRobot».',
    },
  },
};

/** @param {string} [language] @returns {typeof TEXTS.en} */
export function texts(language) {
  return TEXTS[pickLanguage(language)];
}

/**
 * The same text in the four languages, e.g. for an action result.
 * @param {(t: typeof TEXTS.en) => string} pick
 */
export function allLanguages(pick) {
  return Object.fromEntries(Object.entries(TEXTS).map(([lang, table]) => [lang, pick(table)]));
}
