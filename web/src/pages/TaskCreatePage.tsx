import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateTask } from '../hooks/useTasks';
import { useTranslation } from '../contexts/LanguageContext';
import {
  hasSavedDefaultRepoSettings,
  loadDefaultRepoSettings,
  saveDefaultRepoSettings,
} from '../domain/defaultRepoSettings';
import type { RiskLevel } from '../types';

interface FormData {
  title: string;
  objective: string;
  description: string;
  owner: string;
  repoName: string;
  defaultBranch: string;
  riskLevel: RiskLevel;
}

interface FormErrors {
  title?: string;
  objective?: string;
  owner?: string;
  repoName?: string;
  defaultBranch?: string;
}

export function TaskCreatePage() {
  const navigate = useNavigate();
  const createTask = useCreateTask();
  const t = useTranslation();
  const initialRepoSettings = loadDefaultRepoSettings();
  const hasSavedRepoSettings = hasSavedDefaultRepoSettings(initialRepoSettings);

  const [formData, setFormData] = useState<FormData>({
    title: '',
    objective: '',
    description: '',
    owner: initialRepoSettings.owner,
    repoName: initialRepoSettings.repoName,
    defaultBranch: initialRepoSettings.defaultBranch,
    riskLevel: 'low',
  });
  const [showRepositoryFields, setShowRepositoryFields] = useState(!hasSavedRepoSettings);

  const [errors, setErrors] = useState<FormErrors>({});

  const effectiveOwner = formData.owner.trim();
  const effectiveRepoName = formData.repoName.trim();
  const effectiveDefaultBranch = formData.defaultBranch.trim() || 'main';

  const validate = (): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.title.trim()) {
      newErrors.title = t.fieldRequired;
    }
    if (!formData.objective.trim()) {
      newErrors.objective = t.fieldRequired;
    }
    if (!effectiveOwner) {
      newErrors.owner = t.fieldRequired;
    }
    if (!effectiveRepoName) {
      newErrors.repoName = t.fieldRequired;
    }
    if (!effectiveDefaultBranch) {
      newErrors.defaultBranch = t.fieldRequired;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) return;

    // Generate typed_ref from repo info
    const repoSettings = {
      owner: effectiveOwner,
      repoName: effectiveRepoName,
      defaultBranch: effectiveDefaultBranch,
    };
    const typedRef = `github:${repoSettings.owner}:${repoSettings.repoName}:${Date.now()}`;

    try {
      saveDefaultRepoSettings(repoSettings);

      await createTask.mutateAsync({
        title: formData.title,
        objective: formData.objective,
        typed_ref: typedRef,
        repo_ref: {
          provider: 'github',
          owner: repoSettings.owner,
          name: repoSettings.repoName,
          default_branch: repoSettings.defaultBranch,
        },
        risk_level: formData.riskLevel,
        description: formData.description || undefined,
      });

      navigate('/tasks');
    } catch {
      // Error is handled by mutation state
    }
  };

  const handleCancel = () => {
    navigate(-1);
  };

  return (
    <div className="h-full flex flex-col p-6">
      <div className="max-w-2xl mx-auto w-full">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-on-surface">{t.createTaskTitle}</h1>
          <p className="text-on-surface-variant text-sm font-mono mt-1">
            {t.createTaskHint}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Title */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-on-surface-variant mb-2">
              {t.taskTitle} <span className="text-error">*</span>
            </label>
            <input
              type="text"
              id="title"
              name="title"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder={t.titlePlaceholder}
              className={`w-full bg-surface-container-highest rounded-lg px-4 py-3 text-sm font-mono text-on-surface border ${
                errors.title ? 'border-error' : 'border-outline-variant/20'
              } focus:ring-1 focus:ring-primary focus:outline-none`}
            />
            {errors.title && (
              <p className="mt-1 text-xs text-error">{errors.title}</p>
            )}
          </div>

          {/* Objective */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-on-surface-variant mb-2">
              {t.objective} <span className="text-error">*</span>
            </label>
            <textarea
              id="objective"
              name="objective"
              value={formData.objective}
              onChange={(e) => setFormData({ ...formData, objective: e.target.value })}
              placeholder={t.objectivePlaceholder}
              rows={3}
              className={`w-full bg-surface-container-highest rounded-lg px-4 py-3 text-sm font-mono text-on-surface border ${
                errors.objective ? 'border-error' : 'border-outline-variant/20'
              } focus:ring-1 focus:ring-primary focus:outline-none resize-none`}
            />
            {errors.objective && (
              <p className="mt-1 text-xs text-error">{errors.objective}</p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-on-surface-variant mb-2">
              {t.description}
            </label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder={t.descriptionPlaceholder}
              rows={3}
              className="w-full bg-surface-container-highest rounded-lg px-4 py-3 text-sm font-mono text-on-surface border border-outline-variant/20 focus:ring-1 focus:ring-primary focus:outline-none resize-none"
            />
          </div>

          {/* Repository Section */}
          <div className="bg-surface-container rounded-lg p-4 border border-outline-variant/10">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xs font-mono uppercase tracking-wider text-on-surface-variant">
                  {hasSavedRepoSettings ? t.repositoryDefaults : t.repository} <span className="text-error">*</span>
                </h3>
                <p className="mt-2 text-xs font-mono text-on-surface-variant">
                  {hasSavedRepoSettings
                    ? `${effectiveOwner}/${effectiveRepoName} · ${effectiveDefaultBranch}`
                    : t.repositoryRequiredHint}
                </p>
                {hasSavedRepoSettings && (
                  <p className="mt-1 text-xs text-on-surface-variant/80">
                    {t.repositoryDefaultsDesc}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowRepositoryFields((current) => !current)}
                className="shrink-0 rounded px-3 py-1.5 text-xs font-mono text-primary border border-primary/30 hover:border-primary/50 transition-colors"
              >
                {showRepositoryFields ? t.hideRepository : t.changeRepository}
              </button>
            </div>

            {showRepositoryFields && (
              <>
                <div className="mt-4 grid grid-cols-2 gap-4">
                  {/* Owner */}
                  <div>
                    <label className="block text-xs font-mono text-on-surface-variant mb-1">
                      {t.owner}
                    </label>
                    <input
                      type="text"
                      id="owner"
                      name="owner"
                      value={formData.owner}
                      onChange={(e) => setFormData({ ...formData, owner: e.target.value })}
                      placeholder={t.ownerPlaceholder}
                      className={`w-full bg-surface-container-highest rounded px-3 py-2 text-sm font-mono text-on-surface border ${
                        errors.owner ? 'border-error' : 'border-outline-variant/20'
                      } focus:ring-1 focus:ring-primary focus:outline-none`}
                    />
                    {errors.owner && (
                      <p className="mt-1 text-xs text-error">{errors.owner}</p>
                    )}
                  </div>

                  {/* Repository Name */}
                  <div>
                    <label className="block text-xs font-mono text-on-surface-variant mb-1">
                      {t.repositoryName}
                    </label>
                    <input
                      type="text"
                      id="repoName"
                      name="repoName"
                      value={formData.repoName}
                      onChange={(e) => setFormData({ ...formData, repoName: e.target.value })}
                      placeholder={t.repoNamePlaceholder}
                      className={`w-full bg-surface-container-highest rounded px-3 py-2 text-sm font-mono text-on-surface border ${
                        errors.repoName ? 'border-error' : 'border-outline-variant/20'
                      } focus:ring-1 focus:ring-primary focus:outline-none`}
                    />
                    {errors.repoName && (
                      <p className="mt-1 text-xs text-error">{errors.repoName}</p>
                    )}
                  </div>
                </div>

                <div className="mt-4">
                  <label className="block text-xs font-mono text-on-surface-variant mb-1">
                    {t.defaultBranch}
                  </label>
                  <input
                    type="text"
                    id="defaultBranch"
                    name="defaultBranch"
                    value={formData.defaultBranch}
                    onChange={(e) => setFormData({ ...formData, defaultBranch: e.target.value })}
                    placeholder={t.branchPlaceholder}
                    className={`w-full bg-surface-container-highest rounded px-3 py-2 text-sm font-mono text-on-surface border ${
                      errors.defaultBranch ? 'border-error' : 'border-outline-variant/20'
                    } focus:ring-1 focus:ring-primary focus:outline-none`}
                  />
                  {errors.defaultBranch && (
                    <p className="mt-1 text-xs text-error">{errors.defaultBranch}</p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Risk Level */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-on-surface-variant mb-2">
              {t.riskLevel}
            </label>
            <div className="flex gap-3">
              {(['low', 'medium', 'high'] as RiskLevel[]).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setFormData({ ...formData, riskLevel: level })}
                  className={`px-4 py-2 rounded-lg text-sm font-mono transition-colors ${
                    formData.riskLevel === level
                      ? level === 'high'
                        ? 'bg-error/20 text-error border border-error/50'
                        : level === 'medium'
                        ? 'bg-secondary/20 text-secondary border border-secondary/50'
                        : 'bg-primary/20 text-primary border border-primary/50'
                      : 'bg-surface-container-highest text-on-surface-variant border border-outline-variant/20 hover:border-outline-variant'
                  }`}
                >
                  {t[level]}
                </button>
              ))}
            </div>
          </div>

          {/* Error Message */}
          {createTask.isError && (
            <div className="bg-error/10 border border-error/20 rounded-lg p-4">
              <p className="text-error text-sm font-mono">{t.createError}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={handleCancel}
              className="px-6 py-2.5 rounded-lg text-sm font-mono bg-surface-container-highest text-on-surface-variant border border-outline-variant/20 hover:border-outline-variant transition-colors"
            >
              {t.cancel}
            </button>
            <button
              type="submit"
              disabled={createTask.isPending}
              className="px-6 py-2.5 rounded-lg text-sm font-mono bg-primary text-on-primary hover:bg-primary-dim transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {createTask.isPending ? t.creating : t.create}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
