export const LOCALES = ["en", "es", "zh", "ja"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  es: "Español",
  zh: "中文",
  ja: "日本語",
};

type Dict = Record<string, string>;

const dictionaries: Record<Locale, Dict> = {
  en: {
    enterWorld: "Enter the World",
    signIn: "Sign in",
    signUp: "Create account",
    worldHub: "World Hub",
    profile: "Profile",
    play: "Play",
    settings: "Settings",
    language: "Language",
    guestsMayBrowse: "Guests may browse open locations. Play requires an account.",
    poweredBy: "Powered by PixelGrew",
  },
  es: {
    enterWorld: "Entrar al Mundo",
    signIn: "Iniciar sesión",
    signUp: "Crear cuenta",
    worldHub: "Centro del Mundo",
    profile: "Perfil",
    play: "Jugar",
    settings: "Ajustes",
    language: "Idioma",
    guestsMayBrowse: "Los invitados pueden explorar. Jugar requiere una cuenta.",
    poweredBy: "Impulsado por PixelGrew",
  },
  zh: {
    enterWorld: "进入世界",
    signIn: "登录",
    signUp: "创建账户",
    worldHub: "世界枢纽",
    profile: "资料",
    play: "开始游戏",
    settings: "设置",
    language: "语言",
    guestsMayBrowse: "访客可浏览开放地点。游戏需要账户。",
    poweredBy: "由 PixelGrew 驱动",
  },
  ja: {
    enterWorld: "世界へ入る",
    signIn: "サインイン",
    signUp: "アカウント作成",
    worldHub: "ワールドハブ",
    profile: "プロフィール",
    play: "プレイ",
    settings: "設定",
    language: "言語",
    guestsMayBrowse: "ゲストは公開エリアを閲覧できます。プレイにはアカウントが必要です。",
    poweredBy: "Powered by PixelGrew",
  },
};

export function t(locale: Locale, key: string): string {
  return dictionaries[locale]?.[key] ?? dictionaries.en[key] ?? key;
}

export function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}
