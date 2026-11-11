/** Topo e atalhos comuns das páginas de Ajustes (#1071, #1072). */
export { ChangedFilter, useChangedFilter } from './changed-filter';
export {
  countChanged,
  effectiveMode,
  isChangedInPanel,
  parseChangedMode,
  showSetting,
  type ChangedMode,
  type ChangedSource,
} from './changed';
export { OnThisPage, activeSection, showOnThisPage, type OnThisPageSection } from './on-this-page';
export {
  HIGHLIGHT_MS,
  SETTING_ANCHOR_EVENT,
  SettingAnchor,
  anchorKey,
  announceSettingAnchor,
  openAncestors,
  openSection,
  revealSetting,
  settingKeysProps,
  useSettingAnchor,
} from './setting-anchor';
export { SettingsPageHeader, type SettingsCrumb } from './settings-page-header';
