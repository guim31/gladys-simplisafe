// -----------------------------------------------------------------------------
// The `alarm` dashboard widget: the state of a SimpliSafe system, what
// deserves a look (open entries, low batteries, alerts, power, base station
// link), and the arming buttons the configuration allows.
//
// Budget of the core: 8 components, 2 texts, 1 status, 4 buttons. Here: one
// heading, one status list, up to three buttons (or a caption when arming
// from Gladys is off). The current mode is marked by the check-circle icon,
// never by the `primary` style, invisible in dark mode (Gladys#3153).
// Disarming asks for a confirmation (`confirm: true`).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { UserError, WIDGET_KEY } from './hub.js';
import { ARM_MODES } from './simplisafe/model.js';
import { MESSAGES, MODE_NAMES, commandDone, pick } from './texts.js';

// Texts of the widget, by language.
export const TEXT = {
  en: {
    title: 'SimpliSafe',
    state: 'Alarm',
    unknown: 'Unknown',
    base: 'Base station',
    online: 'Online',
    offline: 'Offline',
    power: 'Power',
    mains: 'Mains',
    battery: 'Backup battery',
    openings: 'Open',
    none: 'None',
    lowBatteries: 'Low batteries',
    alerts: 'Alerts',
    controlOff: 'Arming from Gladys is off (configuration).',
    empty: 'Sign in to SimpliSafe from the configuration of the integration.',
  },
  fr: {
    title: 'SimpliSafe',
    state: 'Alarme',
    unknown: 'Inconnu',
    base: 'Base',
    online: 'En ligne',
    offline: 'Hors ligne',
    power: 'Alimentation',
    mains: 'Secteur',
    battery: 'Batterie de secours',
    openings: 'Ouvert',
    none: 'Rien',
    lowBatteries: 'Piles faibles',
    alerts: 'Alertes',
    controlOff: 'Armement depuis Gladys désactivé (configuration).',
    empty: 'Connectez SimpliSafe depuis la configuration de l’intégration.',
  },
  de: {
    title: 'SimpliSafe',
    state: 'Alarm',
    unknown: 'Unbekannt',
    base: 'Basisstation',
    online: 'Online',
    offline: 'Offline',
    power: 'Stromversorgung',
    mains: 'Netz',
    battery: 'Notstrombatterie',
    openings: 'Offen',
    none: 'Nichts',
    lowBatteries: 'Schwache Batterien',
    alerts: 'Meldungen',
    controlOff: 'Scharfschalten über Gladys ist aus (Konfiguration).',
    empty: 'Melde SimpliSafe in der Konfiguration der Integration an.',
  },
  es: {
    title: 'SimpliSafe',
    state: 'Alarma',
    unknown: 'Desconocido',
    base: 'Base',
    online: 'En línea',
    offline: 'Sin conexión',
    power: 'Alimentación',
    mains: 'Red',
    battery: 'Batería de respaldo',
    openings: 'Abierto',
    none: 'Nada',
    lowBatteries: 'Baterías bajas',
    alerts: 'Alertas',
    controlOff: 'El armado desde Gladys está desactivado (configuración).',
    empty: 'Inicie sesión en SimpliSafe desde la configuración de la integración.',
  },
};

const STATE_STYLE = {
  off: { color: WIDGET_COLORS.NEUTRAL, icon: 'shield-off' },
  home: { color: WIDGET_COLORS.SUCCESS, icon: 'shield' },
  away: { color: WIDGET_COLORS.SUCCESS, icon: 'shield' },
  exit_delay: { color: WIDGET_COLORS.WARNING, icon: 'clock' },
  entry_delay: { color: WIDGET_COLORS.WARNING, icon: 'clock' },
  alarm: { color: WIDGET_COLORS.DANGER, icon: 'alert-triangle' },
};

const MODE_ICONS = { home: 'home', away: 'lock', off: 'unlock' };
const ACTION_KEYS = { home: 'arm_home', away: 'arm_away', off: 'disarm' };

const clip = (value, max = 40) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

function statusItems(view, t) {
  const style = STATE_STYLE[view.state] ?? { color: WIDGET_COLORS.NEUTRAL, icon: 'help-circle' };
  const items = [
    { label: t.state, value: view.stateLabel ?? t.unknown, color: style.color, icon: style.icon },
    {
      label: t.base,
      value: view.offline ? t.offline : t.online,
      color: view.offline ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
      icon: view.offline ? 'wifi-off' : 'wifi',
    },
    {
      label: t.power,
      value: view.powerOutage ? t.battery : t.mains,
      color: view.powerOutage ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
      icon: view.powerOutage ? 'battery' : 'zap',
    },
    {
      label: t.openings,
      value: view.openings.length ? clip(view.openings.join(', ')) : t.none,
      color: view.openings.length ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
      icon: 'log-in',
    },
  ];
  if (view.lowBatteries > 0) {
    items.push({
      label: t.lowBatteries,
      value: view.lowBatteries,
      color: WIDGET_COLORS.WARNING,
      icon: 'battery',
    });
  }
  if (view.alerts > 0) {
    items.push({ label: t.alerts, value: view.alerts, color: WIDGET_COLORS.INFO, icon: 'bell' });
  }
  return items;
}

function buttons(view, language) {
  const names = pick(MODE_NAMES, language);
  const modes = ['home', 'away', ...(view.canDisarm ? ['off'] : [])];
  return modes.map((mode) => ({
    type: 'button',
    label: names[mode],
    // The current mode is marked by its icon (the primary style does not show in dark mode).
    icon: view.mode === mode ? 'check-circle' : MODE_ICONS[mode],
    style: mode === 'off' ? 'danger' : 'secondary',
    action: {
      key: ACTION_KEYS[mode],
      params: { system: view.externalId, mode },
      ...(mode === 'off' ? { confirm: true } : {}),
    },
  }));
}

export function alarmContent(hub, { settings = {}, language = 'en' } = {}) {
  const t = TEXT[language] ?? TEXT.en;
  const view = hub.view(settings.system || null, language);
  if (!view) {
    return { ttl_seconds: 60, components: [{ type: 'text', variant: 'body', text: t.empty }] };
  }
  const components = [
    { type: 'text', variant: 'heading', text: clip(view.name || t.title) },
    { type: 'status', items: statusItems(view, t) },
  ];
  if (view.canArm) components.push(...buttons(view, language));
  else components.push({ type: 'text', variant: 'caption', text: t.controlOff });
  return { ttl_seconds: 60, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    get: (hub, request) => alarmContent(hub, request),
    async action(hub, { params = {} }) {
      const mode = String(params.mode ?? '');
      if (!ARM_MODES.includes(mode)) throw new UserError(MESSAGES.failed);
      await hub.setArmMode(params.system || null, mode, 'widget');
      return commandDone(mode);
    },
  },
};
