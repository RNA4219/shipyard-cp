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
    <div className="space-y-3">
      {/* Theme Mode Selection */}
      <div className="space-y-2">
        <label className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant">
          {t.interfaceTheme}
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {/* Dark */}
          <button
            onClick={() => setTheme('dark')}
            className={`p-2 rounded-lg border-2 transition-all ${
              theme === 'dark'
                ? 'border-primary bg-primary/10'
                : 'border-outline-variant/20 hover:border-outline-variant'
            }`}
          >
            <div className="h-6 w-full rounded bg-[#0a0e14] mb-1 flex items-center justify-center border border-outline-variant/20">
              <div className="w-3 h-0.5 bg-primary rounded" />
            </div>
            <span className="text-[10px]">{t.dark}</span>
          </button>

          {/* Light */}
          <button
            onClick={() => setTheme('light')}
            className={`p-2 rounded-lg border-2 transition-all ${
              theme === 'light'
                ? 'border-primary bg-primary/10'
                : 'border-outline-variant/20 hover:border-outline-variant'
            }`}
          >
            <div className="h-6 w-full rounded bg-[#f8f9ff] mb-1 flex items-center justify-center border border-outline-variant/20">
              <div className="w-3 h-0.5 bg-primary rounded" />
            </div>
            <span className="text-[10px]">{t.light}</span>
          </button>

          {/* System */}
          <button
            onClick={() => setTheme('system')}
            className={`p-2 rounded-lg border-2 transition-all ${
              theme === 'system'
                ? 'border-primary bg-primary/10'
                : 'border-outline-variant/20 hover:border-outline-variant'
            }`}
          >
            <div className="h-6 w-full rounded bg-gradient-to-r from-[#0a0e14] to-[#f8f9ff] mb-1 flex items-center justify-center border border-outline-variant/20">
              <span className="material-symbols-outlined text-[10px] text-on-surface">computer</span>
            </div>
            <span className="text-[10px]">{t.system}</span>
          </button>

          {/* Custom */}
          <button
            onClick={() => setTheme('custom')}
            className={`p-2 rounded-lg border-2 transition-all ${
              theme === 'custom'
                ? 'border-primary bg-primary/10'
                : 'border-outline-variant/20 hover:border-outline-variant'
            }`}
          >
            <div className="h-6 w-full rounded bg-surface-container mb-1 flex items-center justify-center border border-outline-variant/20">
              <span className="material-symbols-outlined text-on-surface-variant text-[10px]">palette</span>
            </div>
            <span className="text-[10px]">{t.custom}</span>
          </button>
        </div>
      </div>

      {/* Custom Theme Presets */}
      {theme === 'custom' && (
        <div className="space-y-2 pt-2 border-t border-outline-variant/10">
          <label className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant">
            {t.presets}
          </label>
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => applyPreset('cobaltNeon')}
              className="px-2 py-0.5 rounded text-[10px] bg-surface-container-high hover:bg-surface-container-highest border border-outline-variant/20 transition-colors"
            >
              Cobalt Neon
            </button>
            <button
              onClick={() => applyPreset('forest')}
              className="px-2 py-0.5 rounded text-[10px] bg-surface-container-high hover:bg-surface-container-highest border border-outline-variant/20 transition-colors"
            >
              Forest
            </button>
            <button
              onClick={() => applyPreset('sunset')}
              className="px-2 py-0.5 rounded text-[10px] bg-surface-container-high hover:bg-surface-container-highest border border-outline-variant/20 transition-colors"
            >
              Sunset
            </button>
          </div>

          {/* Color Customization */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pt-2">
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
    <div className="flex flex-col gap-1">
      <span className="text-[9px] font-mono uppercase text-on-surface-variant">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="color"
          id={`${id}-picker`}
          name={`${id}-picker`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-5 h-5 rounded cursor-pointer border border-outline-variant/20 bg-transparent"
        />
        <input
          type="text"
          id={`${id}-text`}
          name={`${id}-text`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-surface-container-highest rounded px-1 py-0.5 text-[10px] font-mono text-on-surface border-none"
        />
      </div>
    </div>
  );
}