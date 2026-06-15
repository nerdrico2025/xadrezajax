/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#0a7ea4';
const tintColorDark = '#fff';

const primaryColor = '#1B5F7A';

export const Colors = {
  light: {
    text: '#0D0D0D',
    background: '#fff',
    tint: '#0a7ea4',
    icon: '#687076',
    tabIconDefault: '#0d0d0d',
    tabIconSelected: '#0a7ea4',
    error: '#FF4D4D',
    link: '#0a7ea4',
    primary: primaryColor,
    secondary: '#555',

    // 🔥 BOTÕES
    buttonPrimary: primaryColor,
    buttonPrimaryText: '#FFFFFF',

    buttonSecondary: '#D7D7D7',
    buttonSecondaryText: '#0D0D0D',
    buttonBorder: 'transparent',
  },

  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: '#fff',
    icon: '#9BA1A6',
    tabIconDefault: '#f5f5f5',
    tabIconSelected: '#0a7ea4',
    error: '#FF4D4D',
    link: '#0a7ea4',
    primary: primaryColor,
    secondary: '#555',

    // 🔥 BOTÕES (AGORA MUDA NO DARK)
    buttonPrimary: '#0a7ea4',
    buttonPrimaryText: '#ffffff',

    buttonSecondary: '#D7D7D7',
    buttonSecondaryText: '#0d0d0d',
    buttonBorder: 'transparent',
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
