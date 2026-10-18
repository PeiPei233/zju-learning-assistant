import { theme, type ThemeConfig } from 'antd';

export const controlMetrics = { height: 34, radius: 6, font: 13, icon: 15 };

export function createControlTheme(dark: boolean): { theme: ThemeConfig; css: string } {
  const colors = dark
    ? { field: '#292928', hover: '#333331', text: '#e4e4df', muted: '#a0a09a', selected: '#383835', focus: '#a7a79f', line: '#3b3b37', error: '#e8958e', primary: '#c5c5c0', canvas: '#191919' }
    : { field: '#efefec', hover: '#e7e7e2', text: '#292927', muted: '#75756e', selected: '#e2e2dc', focus: '#71716a', line: '#d7d7d0', error: '#b13e36', primary: '#454540', canvas: '#ffffff' };
  const fieldTokens = {
    colorFillTertiary: colors.field, colorFillSecondary: colors.hover, colorBorder: 'transparent',
    hoverBg: colors.hover, activeBg: colors.field,
    hoverBorderColor: 'transparent', activeBorderColor: colors.focus,
    activeShadow: `0 0 0 1px ${colors.focus}`, paddingInline: 10, inputFontSize: controlMetrics.font,
  };
  return {
    css: `:root { --status-error: ${colors.error}; --field-bg: ${colors.field}; --field-hover: ${colors.hover}; --focus: ${colors.focus}; --selected: ${colors.selected}; --control-height: ${controlMetrics.height}px; --control-radius: ${controlMetrics.radius}px; --control-font-size: ${controlMetrics.font}px; --control-icon-size: ${controlMetrics.icon}px; }`,
    theme: {
      algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
      token: {
        colorPrimary: colors.primary, colorInfo: colors.primary, colorText: colors.text,
        colorTextSecondary: colors.muted, colorTextPlaceholder: colors.muted,
        colorBgContainer: colors.canvas, colorBorder: colors.line,
        colorFillTertiary: colors.field, colorFillSecondary: colors.hover,
        colorBgContainerDisabled: colors.field, controlItemBgActive: colors.selected,
        controlOutline: colors.focus, controlOutlineWidth: 1,
        borderRadius: controlMetrics.radius, fontSize: controlMetrics.font,
        controlHeight: controlMetrics.height, controlHeightSM: 28,
        fontFamily: 'var(--font-controls)',
      },
      components: {
        Input: fieldTokens, InputNumber: fieldTokens, DatePicker: { ...fieldTokens, cellActiveWithRangeBg: colors.selected },
        Select: {
          ...fieldTokens, selectorBg: colors.field, activeOutlineColor: colors.focus,
          optionSelectedBg: colors.selected, optionActiveBg: colors.hover, optionSelectedColor: colors.text,
          optionSelectedFontWeight: 500, optionFontSize: controlMetrics.font, optionHeight: controlMetrics.height,
          multipleItemBg: colors.selected, multipleItemBorderColor: 'transparent'
        },
        Segmented: { trackBg: colors.field, itemSelectedBg: colors.selected, itemColor: colors.muted, itemSelectedColor: colors.text, itemHoverBg: colors.hover },
        Switch: { trackHeight: 20, trackMinWidth: 36, handleSize: 16, trackPadding: 2, handleShadow: 'none' },
        Checkbox: { colorWhite: colors.canvas, controlInteractiveSize: 16, borderRadiusSM: 4, colorBgContainer: colors.field },
        Button: {
          colorPrimary: colors.text, colorPrimaryHover: colors.text, colorPrimaryActive: colors.text, defaultBg: 'transparent', defaultColor: colors.text, defaultBorderColor: 'transparent',
          defaultHoverBorderColor: 'transparent', defaultActiveBorderColor: 'transparent', defaultHoverBg: colors.hover,
          defaultHoverColor: colors.text, defaultShadow: 'none', primaryColor: colors.canvas, primaryShadow: 'none'
        },
        Table: { headerBg: 'transparent', rowHoverBg: colors.hover, rowSelectedBg: colors.selected, borderColor: colors.line },
        Radio: { buttonPaddingInline: 10 },
      },
    },
  };
}
