# Shipyard CP Frontend Design Specification

## Overview

Shipyard CP はエージェントオーケストレータのフロントエンドとして、IDEライクなインターフェースでエージェントの管理・監視を行う。

## 1. Design System

### 1.1 Theme System

4つのテーマをサポート:

| テーマ | 説明 |
|-------|------|
| **Dark** | 標準ダークテーマ (Material Design 3 Dark) |
| **Light** | 明るいライトテーマ (Material Design 3 Light) |
| **System** | OS設定に自動追従 (`prefers-color-scheme`) |
| **Custom** | ユーザー定義カスタムテーマ |

#### 1.1.1 Theme Storage

```typescript
// localStorage key: 'shipyard-theme'
type ThemeMode = 'dark' | 'light' | 'system' | 'custom';

interface ThemeConfig {
  mode: ThemeMode;
  custom?: CustomThemeColors;
}

// System theme detection
const getSystemTheme = (): 'dark' | 'light' => {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};
```

#### 1.1.2 Theme Provider

```tsx
// src/contexts/ThemeContext.tsx
interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  customColors: CustomThemeColors | null;
  setCustomColors: (colors: CustomThemeColors) => void;
  resolvedTheme: 'dark' | 'light'; // 実際に適用されるテーマ
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Implementation
}
```

### 1.2 Color Palettes

#### 1.2.1 Dark Theme (Default)

```javascript
const darkTheme = {
  // Primary (Blue) - メインアクション、アクティブ状態
  "primary": "#85adff",
  "primary-dim": "#699cff",
  "primary-fixed": "#6e9fff",
  "primary-fixed-dim": "#5391ff",
  "primary-container": "#6e9fff",
  "on-primary": "#002c66",
  "on-primary-fixed": "#000000",
  "on-primary-container": "#002150",

  // Secondary (Purple) - 補助要素、Worker種別
  "secondary": "#ac8aff",
  "secondary-dim": "#8455ef",
  "secondary-fixed": "#dac9ff",
  "secondary-fixed-dim": "#ceb9ff",
  "secondary-container": "#5516be",
  "on-secondary": "#280067",
  "on-secondary-fixed": "#40009b",
  "on-secondary-container": "#d9c8ff",

  // Tertiary (Pink) - 成功、完了状態
  "tertiary": "#fbabff",
  "tertiary-dim": "#e28ce9",
  "tertiary-fixed": "#f199f7",
  "tertiary-fixed-dim": "#e28ce9",
  "tertiary-container": "#f199f7",
  "on-tertiary": "#691d74",
  "on-tertiary-fixed": "#3e0047",
  "on-tertiary-container": "#5e106a",

  // Error - エラー、警告
  "error": "#ff716c",
  "error-dim": "#d7383b",
  "error-container": "#9f0519",
  "on-error": "#490006",
  "on-error-container": "#ffa8a3",

  // Surface - 背景レイヤー
  "background": "#0a0e14",
  "surface": "#0a0e14",
  "surface-dim": "#0a0e14",
  "surface-bright": "#262c36",
  "surface-tint": "#85adff",
  "surface-container": "#151a21",
  "surface-container-low": "#0f141a",
  "surface-container-high": "#1b2028",
  "surface-container-highest": "#20262f",
  "surface-container-lowest": "#000000",
  "surface-variant": "#20262f",

  // On-Surface - テキスト
  "on-background": "#f1f3fc",
  "on-surface": "#f1f3fc",
  "on-surface-variant": "#a8abb3",

  // Outline
  "outline": "#72757d",
  "outline-variant": "#44484f",

  // Inverse
  "inverse-surface": "#f8f9ff",
  "inverse-on-surface": "#51555c",
  "inverse-primary": "#005bc4",
};
```

#### 1.2.2 Light Theme

```javascript
const lightTheme = {
  // Primary (Blue) - メインアクション、アクティブ状態
  "primary": "#005bc4",
  "primary-dim": "#004a9e",
  "primary-fixed": "#6e9fff",
  "primary-fixed-dim": "#5391ff",
  "primary-container": "#dbe8ff",
  "on-primary": "#ffffff",
  "on-primary-fixed": "#000000",
  "on-primary-container": "#001d40",

  // Secondary (Purple) - 補助要素、Worker種別
  "secondary": "#6b31c4",
  "secondary-dim": "#5528a0",
  "secondary-fixed": "#dac9ff",
  "secondary-fixed-dim": "#ceb9ff",
  "secondary-container": "#eedbff",
  "on-secondary": "#ffffff",
  "on-secondary-fixed": "#40009b",
  "on-secondary-container": "#24005c",

  // Tertiary (Pink) - 成功、完了状態
  "tertiary": "#9c27b0",
  "tertiary-dim": "#7b1fa2",
  "tertiary-fixed": "#f199f7",
  "tertiary-fixed-dim": "#e28ce9",
  "tertiary-container": "#ffd6ff",
  "on-tertiary": "#ffffff",
  "on-tertiary-fixed": "#3e0047",
  "on-tertiary-container": "#35003f",

  // Error - エラー、警告
  "error": "#ba1a1a",
  "error-dim": "#93000a",
  "error-container": "#ffdad6",
  "on-error": "#ffffff",
  "on-error-container": "#410002",

  // Surface - 背景レイヤー
  "background": "#f8f9ff",
  "surface": "#f8f9ff",
  "surface-dim": "#d9d9df",
  "surface-bright": "#f8f9ff",
  "surface-tint": "#005bc4",
  "surface-container": "#ececf4",
  "surface-container-low": "#e8e8f0",
  "surface-container-high": "#e6e6ee",
  "surface-container-highest": "#e1e1e9",
  "surface-container-lowest": "#ffffff",
  "surface-variant": "#e1e2ec",

  // On-Surface - テキスト
  "on-background": "#1a1c1e",
  "on-surface": "#1a1c1e",
  "on-surface-variant": "#44474f",

  // Outline
  "outline": "#74777f",
  "outline-variant": "#c4c6d0",

  // Inverse
  "inverse-surface": "#2f3036",
  "inverse-on-surface": "#f1f0f7",
  "inverse-primary": "#85adff",
};
```

#### 1.2.3 Custom Theme Interface

```typescript
interface CustomThemeColors {
  // Primary
  primary: string;
  primaryDim: string;
  primaryContainer: string;
  onPrimary: string;
  onPrimaryContainer: string;

  // Secondary
  secondary: string;
  secondaryDim: string;
  secondaryContainer: string;
  onSecondary: string;
  onSecondaryContainer: string;

  // Tertiary
  tertiary: string;
  tertiaryDim: string;
  tertiaryContainer: string;
  onTertiary: string;
  onTertiaryContainer: string;

  // Error
  error: string;
  errorContainer: string;
  onError: string;
  onErrorContainer: string;

  // Base (必須 - 自動生成される派生色の基準)
  background: string;
  surface: string;
  onSurface: string;

  // Optional
  outline?: string;
  outlineVariant?: string;
}

// Custom Theme Preset Examples
const customThemePresets = {
  // Cobalt Neon (Cyberpunk style)
  cobaltNeon: {
    primary: "#00d4ff",
    primaryContainer: "#003d4d",
    secondary: "#ff00ff",
    secondaryContainer: "#4d004d",
    background: "#0a0a1a",
    surface: "#0f0f2a",
    onSurface: "#e0e0ff",
    // ...
  },

  // Forest (Nature inspired)
  forest: {
    primary: "#4ade80",
    primaryContainer: "#14532d",
    secondary: "#a78bfa",
    secondaryContainer: "#4c1d95",
    background: "#0f1a0f",
    surface: "#1a2a1a",
    onSurface: "#e0f0e0",
    // ...
  },

  // Sunset (Warm tones)
  sunset: {
    primary: "#f97316",
    primaryContainer: "#7c2d12",
    secondary: "#ec4899",
    secondaryContainer: "#831843",
    background: "#1a0f0f",
    surface: "#2a1a1a",
    onSurface: "#f0e0e0",
    // ...
  },
};
```

### 1.3 Tailwind Configuration with Themes

```javascript
// tailwind.config.js
export default {
  darkMode: 'class',
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Dynamic theme colors (applied via CSS variables)
        primary: {
          DEFAULT: 'var(--color-primary)',
          dim: 'var(--color-primary-dim)',
          fixed: 'var(--color-primary-fixed)',
          container: 'var(--color-primary-container)',
        },
        secondary: {
          DEFAULT: 'var(--color-secondary)',
          dim: 'var(--color-secondary-dim)',
          fixed: 'var(--color-secondary-fixed)',
          container: 'var(--color-secondary-container)',
        },
        tertiary: {
          DEFAULT: 'var(--color-tertiary)',
          dim: 'var(--color-tertiary-dim)',
          fixed: 'var(--color-tertiary-fixed)',
          container: 'var(--color-tertiary-container)',
        },
        error: {
          DEFAULT: 'var(--color-error)',
          dim: 'var(--color-error-dim)',
          container: 'var(--color-error-container)',
        },
        background: 'var(--color-background)',
        surface: {
          DEFAULT: 'var(--color-surface)',
          dim: 'var(--color-surface-dim)',
          bright: 'var(--color-surface-bright)',
          tint: 'var(--color-surface-tint)',
          container: {
            DEFAULT: 'var(--color-surface-container)',
            low: 'var(--color-surface-container-low)',
            high: 'var(--color-surface-container-high)',
            highest: 'var(--color-surface-container-highest)',
            lowest: 'var(--color-surface-container-lowest)',
          },
          variant: 'var(--color-surface-variant)',
        },
        'on-background': 'var(--color-on-background)',
        'on-surface': {
          DEFAULT: 'var(--color-on-surface)',
          variant: 'var(--color-on-surface-variant)',
        },
        outline: {
          DEFAULT: 'var(--color-outline)',
          variant: 'var(--color-outline-variant)',
        },
      },
      fontFamily: {
        headline: ['Inter', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        label: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '0.125rem',
        lg: '0.25rem',
        xl: '0.5rem',
        full: '0.75rem',
      },
    },
  },
  plugins: [],
};
```

### 1.4 CSS Variables Setup

```css
/* src/styles/themes.css */

/* Dark Theme (Default) */
:root,
[data-theme="dark"] {
  --color-primary: #85adff;
  --color-primary-dim: #699cff;
  --color-primary-fixed: #6e9fff;
  --color-primary-fixed-dim: #5391ff;
  --color-primary-container: #6e9fff;
  --color-on-primary: #002c66;
  --color-on-primary-fixed: #000000;
  --color-on-primary-container: #002150;

  --color-secondary: #ac8aff;
  --color-secondary-dim: #8455ef;
  --color-secondary-fixed: #dac9ff;
  --color-secondary-fixed-dim: #ceb9ff;
  --color-secondary-container: #5516be;
  --color-on-secondary: #280067;
  --color-on-secondary-fixed: #40009b;
  --color-on-secondary-container: #d9c8ff;

  --color-tertiary: #fbabff;
  --color-tertiary-dim: #e28ce9;
  --color-tertiary-fixed: #f199f7;
  --color-tertiary-fixed-dim: #e28ce9;
  --color-tertiary-container: #f199f7;
  --color-on-tertiary: #691d74;
  --color-on-tertiary-fixed: #3e0047;
  --color-on-tertiary-container: #5e106a;

  --color-error: #ff716c;
  --color-error-dim: #d7383b;
  --color-error-container: #9f0519;
  --color-on-error: #490006;
  --color-on-error-container: #ffa8a3;

  --color-background: #0a0e14;
  --color-surface: #0a0e14;
  --color-surface-dim: #0a0e14;
  --color-surface-bright: #262c36;
  --color-surface-tint: #85adff;
  --color-surface-container: #151a21;
  --color-surface-container-low: #0f141a;
  --color-surface-container-high: #1b2028;
  --color-surface-container-highest: #20262f;
  --color-surface-container-lowest: #000000;
  --color-surface-variant: #20262f;

  --color-on-background: #f1f3fc;
  --color-on-surface: #f1f3fc;
  --color-on-surface-variant: #a8abb3;

  --color-outline: #72757d;
  --color-outline-variant: #44484f;

  --color-inverse-surface: #f8f9ff;
  --color-inverse-on-surface: #51555c;
  --color-inverse-primary: #005bc4;
}

/* Light Theme */
[data-theme="light"] {
  --color-primary: #005bc4;
  --color-primary-dim: #004a9e;
  --color-primary-fixed: #6e9fff;
  --color-primary-fixed-dim: #5391ff;
  --color-primary-container: #dbe8ff;
  --color-on-primary: #ffffff;
  --color-on-primary-fixed: #000000;
  --color-on-primary-container: #001d40;

  --color-secondary: #6b31c4;
  --color-secondary-dim: #5528a0;
  --color-secondary-fixed: #dac9ff;
  --color-secondary-fixed-dim: #ceb9ff;
  --color-secondary-container: #eedbff;
  --color-on-secondary: #ffffff;
  --color-on-secondary-fixed: #40009b";
  --color-on-secondary-container: #24005c;

  --color-tertiary: #9c27b0;
  --color-tertiary-dim: #7b1fa2;
  --color-tertiary-fixed: #f199f7;
  --color-tertiary-fixed-dim: #e28ce9;
  --color-tertiary-container: #ffd6ff;
  --color-on-tertiary: #ffffff;
  --color-on-tertiary-fixed: #3e0047;
  --color-on-tertiary-container: #35003f;

  --color-error: #ba1a1a;
  --color-error-dim: #93000a;
  --color-error-container: #ffdad6;
  --color-on-error: #ffffff;
  --color-on-error-container: #410002;

  --color-background: #f8f9ff;
  --color-surface: #f8f9ff;
  --color-surface-dim: #d9d9df;
  --color-surface-bright: #f8f9ff;
  --color-surface-tint: #005bc4;
  --color-surface-container: #ececf4;
  --color-surface-container-low: #e8e8f0;
  --color-surface-container-high: #e6e6ee;
  --color-surface-container-highest: #e1e1e9;
  --color-surface-container-lowest: #ffffff;
  --color-surface-variant: #e1e2ec;

  --color-on-background: #1a1c1e;
  --color-on-surface: #1a1c1e;
  --color-on-surface-variant: #44474f;

  --color-outline: #74777f;
  --color-outline-variant: #c4c6d0;

  --color-inverse-surface: #2f3036;
  --color-inverse-on-surface: #f1f0f7;
  --color-inverse-primary: #85adff;
}

/* Custom Theme - Applied dynamically via JavaScript */
[data-theme="custom"] {
  /* Variables set dynamically by ThemeContext */
}
```

### 1.5 Theme Selector Component

```tsx
// src/components/settings/ThemeSelector.tsx
import { useTheme } from '../../hooks/useTheme';

export function ThemeSelector() {
  const { theme, setTheme, customColors, setCustomColors } = useTheme();

  return (
    <div className="space-y-6">
      {/* Theme Mode Selection */}
      <div className="space-y-4">
        <label className="text-xs font-mono uppercase tracking-wider text-on-surface-variant">
          Interface Theme
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {/* Dark */}
          <button
            onClick={() => setTheme('dark')}
            className={`p-4 rounded-lg border-2 transition-all ${
              theme === 'dark'
                ? 'border-primary bg-primary/10'
                : 'border-outline-variant/20 hover:border-outline-variant'
            }`}
          >
            <div className="h-12 w-full rounded bg-[#0a0e14] mb-2 flex items-center justify-center">
              <div className="w-6 h-1 bg-primary rounded" />
            </div>
            <span className="text-sm">Dark</span>
          </button>

          {/* Light */}
          <button
            onClick={() => setTheme('light')}
            className={`p-4 rounded-lg border-2 transition-all ${
              theme === 'light'
                ? 'border-primary bg-primary/10'
                : 'border-outline-variant/20 hover:border-outline-variant'
            }`}
          >
            <div className="h-12 w-full rounded bg-[#f8f9ff] mb-2 flex items-center justify-center">
              <div className="w-6 h-1 bg-primary rounded" />
            </div>
            <span className="text-sm">Light</span>
          </button>

          {/* System */}
          <button
            onClick={() => setTheme('system')}
            className={`p-4 rounded-lg border-2 transition-all ${
              theme === 'system'
                ? 'border-primary bg-primary/10'
                : 'border-outline-variant/20 hover:border-outline-variant'
            }`}
          >
            <div className="h-12 w-full rounded bg-gradient-to-r from-[#0a0e14] to-[#f8f9ff] mb-2 flex items-center justify-center">
              <span className="material-symbols-outlined text-sm">computer</span>
            </div>
            <span className="text-sm">System</span>
          </button>

          {/* Custom */}
          <button
            onClick={() => setTheme('custom')}
            className={`p-4 rounded-lg border-2 transition-all ${
              theme === 'custom'
                ? 'border-primary bg-primary/10'
                : 'border-outline-variant/20 hover:border-outline-variant'
            }`}
          >
            <div className="h-12 w-full rounded bg-gradient-to-br from-purple-500 to-pink-500 mb-2 flex items-center justify-center">
              <span className="material-symbols-outlined text-white text-sm">palette</span>
            </div>
            <span className="text-sm">Custom</span>
          </button>
        </div>
      </div>

      {/* Custom Theme Color Picker */}
      {theme === 'custom' && (
        <div className="space-y-4 pt-4 border-t border-outline-variant/10">
          <label className="text-xs font-mono uppercase tracking-wider text-on-surface-variant">
            Customize Colors
          </label>

          {/* Preset Themes */}
          <div className="space-y-2">
            <span className="text-xs text-on-surface-variant">Presets</span>
            <div className="flex gap-2">
              <button
                onClick={() => setCustomColors(customThemePresets.cobaltNeon)}
                className="px-3 py-1.5 rounded text-xs bg-cyan-900/50 text-cyan-300 hover:bg-cyan-900/70"
              >
                Cobalt Neon
              </button>
              <button
                onClick={() => setCustomColors(customThemePresets.forest)}
                className="px-3 py-1.5 rounded text-xs bg-green-900/50 text-green-300 hover:bg-green-900/70"
              >
                Forest
              </button>
              <button
                onClick={() => setCustomColors(customThemePresets.sunset)}
                className="px-3 py-1.5 rounded text-xs bg-orange-900/50 text-orange-300 hover:bg-orange-900/70"
              >
                Sunset
              </button>
            </div>
          </div>

          {/* Color Inputs */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <ColorInput
              label="Primary"
              value={customColors?.primary || '#85adff'}
              onChange={(v) => setCustomColors({ ...customColors, primary: v })}
            />
            <ColorInput
              label="Secondary"
              value={customColors?.secondary || '#ac8aff'}
              onChange={(v) => setCustomColors({ ...customColors, secondary: v })}
            />
            <ColorInput
              label="Tertiary"
              value={customColors?.tertiary || '#fbabff'}
              onChange={(v) => setCustomColors({ ...customColors, tertiary: v })}
            />
            <ColorInput
              label="Background"
              value={customColors?.background || '#0a0e14'}
              onChange={(v) => setCustomColors({ ...customColors, background: v })}
            />
            <ColorInput
              label="Surface"
              value={customColors?.surface || '#0a0e14'}
              onChange={(v) => setCustomColors({ ...customColors, surface: v })}
            />
            <ColorInput
              label="Text"
              value={customColors?.onSurface || '#f1f3fc'}
              onChange={(v) => setCustomColors({ ...customColors, onSurface: v })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] font-mono uppercase text-on-surface-variant">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-8 h-8 rounded cursor-pointer border-none"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-surface-container-highest rounded px-2 py-1 text-xs font-mono"
        />
      </div>
    </div>
  );
}
```

### 1.6 Typography

```javascript
fontFamily: {
  "headline": ["Inter", "sans-serif"],
  "body": ["Inter", "sans-serif"],
  "label": ["Inter", "sans-serif"],
  "mono": ["JetBrains Mono", "monospace"],
}
```

### 1.7 Border Radius

```javascript
borderRadius: {
  "DEFAULT": "0.125rem",  // 2px - シャープ
  "lg": "0.25rem",        // 4px
  "xl": "0.5rem",         // 8px
  "full": "0.75rem",      // 12px
}
```

### 1.8 Icon System

- **Material Symbols Outlined** (Google Fonts)
- 使用方法: `<span class="material-symbols-outlined">icon_name</span>`
- 主要アイコン: `folder_open`, `search`, `smart_toy`, `settings`, `terminal`, `bug_report`, `bolt`, `task_alt`, `play_arrow`, `pause`, `stop`, `dark_mode`, `light_mode`, `computer`, `palette`

---

## 2. Layout Architecture

### 2.1 Structure Overview

```
┌──────────────────────────────────────────────────────────────┐
│                        TopNavBar (h-10)                       │
├────┬─────────────────────────────────────────────────────────┤
│    │                                                          │
│ S  │                    Main Content                          │
│ i  │                                                          │
│ d  │    ┌──────────────────────────────────────────────┐     │
│ e  │    │              Content Area                    │     │
│ N  │    │                                              │     │
│ a  │    │         (Kanban / Settings / IDE)           │     │
│ v  │    │                                              │     │
│ B  │    └──────────────────────────────────────────────┘     │
│ a  │                                                          │
│ r  │    ┌──────────────────────────────────────────────┐     │
│    │    │           Terminal / Log Area (h-32)         │     │
├────┴────────────────────────────────────────────────────┤
│                        FAB (bottom-right)                     │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 SideNavBar (Rail)

**仕様:**
- 幅: `w-16` (64px)
- 位置: `fixed left-0 top-0 h-full`
- 背景: `bg-slate-950`
- ボーダー: `border-r border-slate-800/50`

**構造:**
```tsx
<aside class="fixed left-0 top-0 h-full z-50 w-16 flex flex-col items-center py-4">
  {/* Logo */}
  <div class="mb-8 text-blue-400 font-mono font-bold text-lg">OA</div>

  {/* Main Navigation */}
  <nav class="flex flex-col gap-6 flex-1">
    <button class="text-blue-400 bg-blue-500/10 border-l-2 border-blue-500">
      <span class="material-symbols-outlined">folder_open</span>
    </button>
    {/* ... other nav items */}
  </nav>

  {/* Bottom Actions */}
  <div class="flex flex-col gap-6 mt-auto">
    <button><span class="material-symbols-outlined">terminal</span></button>
    <button><span class="material-symbols-outlined">bug_report</span></button>
  </div>
</aside>
```

**ナビゲーションアイテム:**
| アイコン | ラベル | 用途 |
|---------|-------|------|
| `folder_open` | Explorer | プロジェクト/タスク一覧 |
| `search` | Search | 検索 |
| `smart_toy` | Agents | エージェント管理 (Active) |
| `settings` | Settings | 設定 |
| `terminal` | Terminal | ターミナル表示 |
| `bug_report` | Debug | デバッグ情報 |

### 2.3 TopNavBar

**仕様:**
- 高さ: `h-10` (40px)
- 位置: `fixed top-0 left-16 right-0`
- 背景: `bg-slate-950/80 backdrop-blur-md`

**構造:**
```tsx
<header class="fixed top-0 left-16 right-0 z-40 h-10 px-4 border-b border-slate-900 bg-slate-950/80 backdrop-blur-md">
  <div class="flex items-center gap-6">
    <span class="text-slate-200 font-bold tracking-tighter font-mono text-xs uppercase">Obsidian IDE</span>
    <nav class="flex gap-4">
      <a class="text-blue-400">Project</a>
      <a class="text-slate-400 hover:text-blue-300">Edit</a>
      <a class="text-slate-400 hover:text-blue-300">Selection</a>
      <a class="text-slate-400 hover:text-blue-300">View</a>
    </nav>
  </div>
  <div class="flex items-center gap-4">
    {/* Search Input */}
    <div class="bg-surface-container-highest px-2 py-0.5 rounded">
      <span class="material-symbols-outlined text-[14px]">search</span>
      <input placeholder="CMD + P" />
    </div>
    <span class="material-symbols-outlined">notifications</span>
    <span class="material-symbols-outlined">account_circle</span>
  </div>
</header>
```

---

## 3. Page Components

### 3.1 Agent Orchestrator (Kanban Board)

**用途:** エージェントとタスクの状態をKanbanボードで可視化・管理

**カラム構成:**

| カラム | 用途 | 色 |
|-------|------|-----|
| Backlog | 待機中のタスク | `outline` (グレー) |
| Active Agents | 実行中のエージェント | `primary` (青) |
| In Progress | 処理中のタスク | `secondary` (紫) |
| Completed | 完了したタスク | `tertiary` (ピンク) |

**エージェントカード構造:**
```tsx
<div class="bg-surface-container-high p-4 rounded-lg border-l-2 border-primary shadow-lg">
  {/* Status Badge */}
  <div class="flex justify-between items-start mb-3">
    <span class="text-[10px] font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">
      <span class="w-1 h-1 rounded-full bg-primary animate-pulse"></span> RUNNING
    </span>
    <span class="text-[10px] font-mono">3 Agents Running</span>
  </div>

  {/* Title */}
  <h3 class="text-sm font-semibold mb-2">Refactoring Auth Service</h3>

  {/* Progress Info */}
  <p class="text-[11px] font-mono text-primary/80 mb-4">
    Parsing abstract syntax tree for dependency injection...
  </p>

  {/* Meta Grid */}
  <div class="grid grid-cols-2 gap-2 mb-4">
    <div class="bg-surface-container-lowest p-2 rounded">
      <p class="text-[9px] text-outline uppercase">Path</p>
      <code class="text-[10px] font-mono">/src/components/Auth</code>
    </div>
    <div class="bg-surface-container-lowest p-2 rounded">
      <p class="text-[9px] text-outline uppercase">Stack</p>
      <span class="text-[10px] font-mono">React Client</span>
    </div>
  </div>

  {/* Footer */}
  <div class="flex items-center justify-between pt-3 border-t border-outline-variant/10">
    <div class="flex items-center gap-1">
      <span class="material-symbols-outlined text-[14px] text-secondary">schema</span>
      <span class="text-[10px] font-mono">12 Sub-tasks</span>
    </div>
    <button class="bg-primary/10 text-primary px-3 py-1 rounded text-[10px] font-bold uppercase">
      View Code
    </button>
  </div>
</div>
```

### 3.2 Settings Page

**構造:**
- 左サイドバー: 設定カテゴリナビゲーション
- メインエリア: 設定フォーム

**設定カテゴリ:**
| カテゴリ | アイコン | 内容 |
|---------|---------|------|
| General | `settings` | 一般設定 |
| Editor | `edit_square` | エディタ設定 |
| Terminal | `terminal` | ターミナル設定 |
| AI Models | `neurology` | AIモデル設定 |
| Keybindings | `keyboard` | キーバインド |

### 3.3 IDE Dashboard

**用途:** コードレビュー、ファイル操作、AIアシスタント連携

**構造:**
- 左: ファイルエクスプローラ (w-64)
- 中央: コードエディタ + ターミナル
- 右: AIアシスタントサイドバー (w-80)

### 3.4 Onboarding Page

**用途:** 初回起動時のワークスペース選択

**オプション:**
1. Clone from GitHub - リモートリポジトリをクローン
2. Open Local Folder - ローカルフォルダを開く
3. Connect via SSH - SSH接続

---

## 4. Component Specifications

### 4.1 Task State Badge

```tsx
interface StateBadgeProps {
  state: 'queued' | 'dispatched' | 'running' | 'succeeded' | 'failed' | 'blocked';
}

const stateConfig = {
  queued: { color: 'outline', label: 'IDLE', animate: false },
  dispatched: { color: 'secondary', label: 'QUEUED', animate: false },
  running: { color: 'primary', label: 'RUNNING', animate: true },
  succeeded: { color: 'tertiary', label: 'SUCCESS', animate: false },
  failed: { color: 'error', label: 'FAILED', animate: false },
  blocked: { color: 'secondary', label: 'STALLED', animate: false },
};
```

### 4.2 Log Terminal

**仕様:**
- 高さ: `h-32` (128px)
- 背景: `bg-surface-container-lowest`
- フォント: `font-mono text-[11px]`
- スクロール: `overflow-y-auto custom-scrollbar`

**ログフォーマット:**
```
[HH:MM:SS] LEVEL: Message
```

### 4.3 FAB (Floating Action Button)

**仕様:**
- 位置: `fixed bottom-8 right-8`
- サイズ: `w-14 h-14`
- 背景: `bg-gradient-to-br from-primary to-primary-container`
- アイコン: `bolt`

---

## 5. Integration with Backend API

### 5.1 WebSocket Events

```typescript
interface WebSocketEvents {
  'task:created': Task;
  'task:updated': Task;
  'agent:started': Agent;
  'agent:progress': { id: string; progress: number; message: string };
  'agent:completed': Agent;
  'log:entry': { timestamp: string; level: string; message: string };
}
```

### 5.2 REST API Endpoints

| Endpoint | Method | 用途 |
|----------|--------|------|
| `/api/tasks` | GET, POST | タスク一覧・作成 |
| `/api/tasks/:id` | GET, PUT, DELETE | タスク詳細 |
| `/api/runs` | GET, POST | Run一覧・作成 |
| `/api/runs/:id` | GET | Run詳細 |
| `/api/agents` | GET | アクティブエージェント一覧 |
| `/api/metrics` | GET | システムメトリクス |

---

## 6. Implementation Priority

### Phase 1: Core Layout (必須)
1. [ ] Tailwind設定の更新 (color palette)
2. [ ] SideNavBar (Rail) コンポーネント
3. [ ] TopNavBar コンポーネント
4. [ ] MainLayout の更新

### Phase 2: Agent Dashboard (必須)
1. [ ] Kanban Board コンポーネント
2. [ ] Agent Card コンポーネント
3. [ ] Task Card コンポーネント
4. [ ] State Badge コンポーネント

### Phase 3: Monitoring (必須)
1. [ ] Log Terminal コンポーネント
2. [ ] Real-time log streaming
3. [ ] Metrics display

### Phase 4: Settings (推奨)
1. [ ] Settings Page
2. [ ] Settings forms

### Phase 5: AI Integration (将来)
1. [ ] AI Assistant Sidebar
2. [ ] Code preview integration

---

## 7. File Structure

```
web/src/
├── components/
│   ├── layout/
│   │   ├── MainLayout.tsx      # 更新
│   │   ├── SideNavBar.tsx      # 新規 (Rail)
│   │   ├── TopNavBar.tsx       # 新規
│   │   └── Header.tsx          # 削除 → TopNavBarへ
│   ├── dashboard/
│   │   ├── KanbanBoard.tsx     # 新規
│   │   ├── KanbanColumn.tsx    # 新規
│   │   ├── AgentCard.tsx       # 新規
│   │   └── TaskCard.tsx        # 新規
│   ├── common/
│   │   ├── StateBadge.tsx      # 更新
│   │   ├── LoadingSpinner.tsx  # 更新
│   │   ├── LogTerminal.tsx     # 新規
│   │   └── FAB.tsx             # 新規
│   └── settings/
│       ├── SettingsSidebar.tsx # 新規
│       └── SettingsForm.tsx    # 新規
├── pages/
│   ├── DashboardPage.tsx       # 新規 (Kanban)
│   ├── TasksPage.tsx           # 更新
│   ├── RunsPage.tsx            # 更新
│   └── SettingsPage.tsx        # 新規
├── hooks/
│   ├── useWebSocket.ts         # 既存
│   └── useAgents.ts            # 新規
└── styles/
    └── index.css               # Material Symbols設定追加
```

---

## 8. Dependencies

```json
{
  "dependencies": {
    "react": "^19",
    "react-router-dom": "^7",
    "@tanstack/react-query": "^5",
    "clsx": "^2",
    "lucide-react": "削除 → Material Symbols使用"
  },
  "devDependencies": {
    "tailwindcss": "^3",
    "autoprefixer": "^10",
    "postcss": "^8"
  }
}
```

---

## 9. CSS Additions

```css
/* Material Symbols Configuration */
.material-symbols-outlined {
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
  vertical-align: middle;
}

/* Custom Scrollbar */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #20262f;
  border-radius: 10px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: #44484f;
}

/* Selection */
::selection {
  background-color: rgba(133, 173, 255, 0.3);
}
```