import { useTheme, customThemePresets, type CustomThemeColors } from '../../contexts/ThemeContext';
import { useTranslation } from '../../contexts/LanguageContext';

export function ThemeSelector() {
  const { theme, setTheme, customColors, setCustomColors } = useTheme();
  const t = useTranslation();

  const applyPreset = (presetName: keyof typeof customThemePresets) => {
    const preset = customThemePresets[presetName];
    const defaultColors: CustomThemeColors = {
      primary: '#85adff',
      primaryDim: '#699cff',
      primaryContainer: '#6e9fff',
      onPrimary: '#002c66',
      onPrimaryContainer: '#002150',
      secondary: '#ac8aff',
      secondaryDim: '#8455ef',
      secondaryContainer: '#5516be',
      onSecondary: '#280067',
      onSecondaryContainer: '#d9c8ff',
      tertiary: '#fbabff',
      tertiaryDim: '#e28ce9',
      tertiaryContainer: '#f199f7',
      onTertiary: '#691d74',
      onTertiaryContainer: '#5e106a',
      error: '#ff716c',
      errorContainer: '#9f0519',
      onError: '#490006',
      onErrorContainer: '#ffa8a3',
      background: '#0a0e14',
      surface: '#0a0e14',
      surfaceDim: '#0a0e14',
      surfaceBright: '#262c36',
      surfaceContainer: '#151a21',
      surfaceContainerLow: '#0f141a',
      surfaceContainerHigh: '#1b2028',
      surfaceContainerHighest: '#20262f',
      surfaceContainerLowest: '#000000',
      onSurface: '#f1f3fc',
      onSurfaceVariant: '#a8abb3',
      outline: '#72757d',
      outlineVariant: '#44484f',
    };
    setCustomColors({ ...defaultColors, ...preset } as CustomThemeColors);
    setTheme('custom');
  };

  return (
    <div className="space-y-6">
      {/* Theme Mode Selection */}
      <div className="space-y-4">
        <label className="text-xs font-mono uppercase tracking-wider text-on-surface-variant">
          {t.interfaceTheme}
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
            <div className="h-12 w-full rounded bg-[#0a0e14] mb-2 flex items-center justify-center border border-outline-variant/20">
              <div className="w-6 h-1 bg-primary rounded" />
            </div>
            <span className="text-sm">{t.dark}</span>
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
            <div className="h-12 w-full rounded bg-[#f8f9ff] mb-2 flex items-center justify-center border border-outline-variant/20">
              <div className="w-6 h-1 bg-primary rounded" />
            </div>
            <span className="text-sm">{t.light}</span>
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
            <div className="h-12 w-full rounded bg-gradient-to-r from-[#0a0e14] to-[#f8f9ff] mb-2 flex items-center justify-center border border-outline-variant/20">
              <span className="material-symbols-outlined text-sm text-on-surface">computer</span>
            </div>
            <span className="text-sm">{t.system}</span>
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
            <div className="h-12 w-full rounded bg-gradient-to-br from-purple-500 to-pink-500 mb-2 flex items-center justify-center border border-outline-variant/20">
              <span className="material-symbols-outlined text-white text-sm">palette</span>
            </div>
            <span className="text-sm">{t.custom}</span>
          </button>
        </div>
      </div>

      {/* Custom Theme Presets */}
      {theme === 'custom' && (
        <div className="space-y-4 pt-4 border-t border-outline-variant/10">
          <label className="text-xs font-mono uppercase tracking-wider text-on-surface-variant">
            {t.presets}
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => applyPreset('cobaltNeon')}
              className="px-3 py-1.5 rounded text-xs bg-cyan-900/30 text-cyan-400 hover:bg-cyan-900/50 border border-cyan-500/30 transition-colors"
            >
              Cobalt Neon
            </button>
            <button
              onClick={() => applyPreset('forest')}
              className="px-3 py-1.5 rounded text-xs bg-green-900/30 text-green-400 hover:bg-green-900/50 border border-green-500/30 transition-colors"
            >
              Forest
            </button>
            <button
              onClick={() => applyPreset('sunset')}
              className="px-3 py-1.5 rounded text-xs bg-orange-900/30 text-orange-400 hover:bg-orange-900/50 border border-orange-500/30 transition-colors"
            >
              Sunset
            </button>
          </div>

          {/* Color Customization */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-4">
            <ColorInput
              label="Primary"
              value={customColors?.primary || '#85adff'}
              onChange={(v) => customColors && setCustomColors({ ...customColors, primary: v })}
            />
            <ColorInput
              label="Secondary"
              value={customColors?.secondary || '#ac8aff'}
              onChange={(v) => customColors && setCustomColors({ ...customColors, secondary: v })}
            />
            <ColorInput
              label="Tertiary"
              value={customColors?.tertiary || '#fbabff'}
              onChange={(v) => customColors && setCustomColors({ ...customColors, tertiary: v })}
            />
            <ColorInput
              label="Background"
              value={customColors?.background || '#0a0e14'}
              onChange={(v) => customColors && setCustomColors({ ...customColors, background: v })}
            />
            <ColorInput
              label="Surface"
              value={customColors?.surface || '#0a0e14'}
              onChange={(v) => customColors && setCustomColors({ ...customColors, surface: v })}
            />
            <ColorInput
              label="Text"
              value={customColors?.onSurface || '#f1f3fc'}
              onChange={(v) => customColors && setCustomColors({ ...customColors, onSurface: v })}
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
  const id = `color-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] font-mono uppercase text-on-surface-variant">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          id={`${id}-picker`}
          name={`${id}-picker`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-8 h-8 rounded cursor-pointer border border-outline-variant/20 bg-transparent"
        />
        <input
          type="text"
          id={`${id}-text`}
          name={`${id}-text`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-surface-container-highest rounded px-2 py-1 text-xs font-mono text-on-surface border-none"
        />
      </div>
    </div>
  );
}