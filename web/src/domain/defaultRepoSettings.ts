export interface DefaultRepoSettings {
  owner: string;
  repoName: string;
  defaultBranch: string;
}

export const DEFAULT_REPO_SETTINGS_KEY = 'shipyard-default-repo';

export const defaultRepoSettings: DefaultRepoSettings = {
  owner: '',
  repoName: '',
  defaultBranch: 'main',
};

export function loadDefaultRepoSettings(): DefaultRepoSettings {
  if (typeof window === 'undefined') {
    return defaultRepoSettings;
  }

  const raw = localStorage.getItem(DEFAULT_REPO_SETTINGS_KEY);
  if (!raw) {
    return defaultRepoSettings;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<DefaultRepoSettings>;
    return {
      owner: parsed.owner?.trim() ?? '',
      repoName: parsed.repoName?.trim() ?? '',
      defaultBranch: parsed.defaultBranch?.trim() || 'main',
    };
  } catch {
    return defaultRepoSettings;
  }
}

export function hasSavedDefaultRepoSettings(settings: DefaultRepoSettings): boolean {
  return Boolean(settings.owner && settings.repoName && settings.defaultBranch);
}

export function saveDefaultRepoSettings(settings: DefaultRepoSettings) {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.setItem(DEFAULT_REPO_SETTINGS_KEY, JSON.stringify({
    owner: settings.owner.trim(),
    repoName: settings.repoName.trim(),
    defaultBranch: settings.defaultBranch.trim() || 'main',
  }));
}
