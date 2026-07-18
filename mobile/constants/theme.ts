import { Platform } from 'react-native';

const primaryColor = '#1B5F7A';

// Dourado AJAX (RF-VISUAL-01) — cor de marca fixa entre temas, reservada a
// destaque/status/conversão. Não usar como cor de texto sobre fundo claro
// (contraste 2.17:1); para texto sobre dourado, usar accentText (8.5:1).
const accentColor = '#C9A84C';
const accentTextColor = '#0D0D0D';
// Dourado com transparência (~12%) para fundos sutis de destaque. Overlay que
// funciona sobre superfícies claras e escuras (PR F, Parte 1).
const accentMutedColor = 'rgba(201, 168, 76, 0.12)';
// Estado de toque (pressed) da CTA dourada — dourado levemente escurecido.
const accentPressedColor = '#B39440';

export const Colors = {
  light: {
    // Texto e fundo
    text: '#0D0D0D',
    background: '#F8F9FA',
    card: '#FFFFFF',

    // Primária e destaque
    primary: primaryColor,
    primaryText: '#FFFFFF',
    accent: accentColor,
    accentText: accentTextColor,
    accentMuted: accentMutedColor,
    accentPressed: accentPressedColor,
    // Dourado como TEXTO/ícone sobre fundo claro: #C9A84C reprova WCAG no tema
    // claro (2.17:1), então usamos um dourado escurecido dedicado. Passa AA
    // (≥4.5:1) inclusive sobre accentMuted composto no card (4.8–5.5:1).
    accentOnLight: '#826417',

    // Secundária (textos de apoio, placeholders)
    secondary: '#6B7280',

    // Ícones
    icon: '#6B7280',
    tabIconDefault: '#9CA3AF',
    tabIconSelected: primaryColor,

    // Botões
    buttonPrimary: primaryColor,
    buttonPrimaryText: '#FFFFFF',
    buttonSecondary: '#E5E7EB',
    buttonSecondaryText: '#1F2937',

    // Bordas e divisores
    divider: '#E5E7EB',
    border: '#D1D5DB',
    buttonBorder: '#D1D5DB',

    // Estados
    error: '#EF4444',
    success: '#22C55E',
    // Amarelo de cautela (não laranja — D4). Era #F59E0B (matiz laranja ~38°).
    warning: '#EAB308',

    // Misc
    tint: primaryColor,
    link: primaryColor,
  },

  dark: {
    // Texto e fundo
    text: '#F1F5F9',
    background: '#0F1117',
    card: '#1E2130',

    // Primária e destaque
    primary: '#2E86AB',
    primaryText: '#FFFFFF',
    accent: accentColor,
    accentText: accentTextColor,
    accentMuted: accentMutedColor,
    accentPressed: accentPressedColor,
    // No tema escuro o dourado #C9A84C passa como texto (8.2:1), então
    // accentOnLight = accent — o token existe nos dois temas para uso uniforme.
    accentOnLight: accentColor,

    // Secundária (textos de apoio — legível no fundo escuro)
    secondary: '#94A3B8',

    // Ícones
    icon: '#64748B',
    tabIconDefault: '#64748B',
    tabIconSelected: '#2E86AB',

    // Botões
    buttonPrimary: '#2E86AB',
    buttonPrimaryText: '#FFFFFF',
    buttonSecondary: '#2A2F3E',
    buttonSecondaryText: '#F1F5F9',

    // Bordas e divisores
    divider: '#2A2F3E',
    border: '#374151',
    buttonBorder: '#374151',

    // Estados
    error: '#F87171',
    success: '#4ADE80',
    warning: '#FCD34D',

    // Misc
    tint: '#2E86AB',
    link: '#60A5FA',
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
