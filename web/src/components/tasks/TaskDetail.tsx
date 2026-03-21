import { useParams, Link } from 'react-router-dom';
import { useTask, useTaskEvents, useDispatch, useCancelTask, useCompleteAcceptance, useUpdateTask } from '../../hooks/useTasks';
import { StateBadge, RiskBadge } from '../common/StateBadge';
import { LoadingSpinner, LoadingPage } from '../common/LoadingSpinner';
import { useTranslation } from '../../contexts/LanguageContext';
import { useNotifications } from '../../contexts/NotificationContext';
import {
  ArrowLeft,
  XCircle,
  GitBranch,
  AlertCircle,
  CheckCircle2,
  XCircle as XCircleIcon,
  Activity,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Task, WorkerStage } from '../../types';

function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString();
}

function stateToTranslationKey(state: string): string {
  const stateMap: Record<string, string> = {
    in_progress: 'inProgress',
    dev_completed: 'devCompleted',
    dev_done: 'devDone',
    publish_pending_approval: 'publishPendingApproval',
  };
  return stateMap[state] || state;
}

function getTranslatedState(state: string | undefined, t: Record<string, string>): string {
  if (!state) return '';
  const key = stateToTranslationKey(state);
  return t[key as keyof typeof t] || state;
}

function getTranslatedStage(stage: WorkerStage, t: Record<string, string>): string {
  const stageMap: Record<WorkerStage, string> = {
    plan: t.stagePlan,
    dev: t.stageDev,
    acceptance: t.stageAcceptance,
  };
  return stageMap[stage] ?? stage;
}

function getTranslatedReason(reason: string | undefined, t: Record<string, string>): string | null {
  if (!reason) return null;

  const normalizedReason = reason.toLowerCase();
  if (normalizedReason === 'task created') {
    return t.reasonTaskCreated;
  }

  const dispatchMatch = normalizedReason.match(/^dispatched (plan|dev|acceptance) job$/);
  if (dispatchMatch) {
    const stage = dispatchMatch[1] as WorkerStage;
    return `${t.dispatch} ${getTranslatedStage(stage, t)}`;
  }

  return null;
}

function StageButton({
  stageLabel,
  disabled,
  onClick,
  label,
}: {
  stageLabel: string;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-1.5 bg-[#0e639c] hover:bg-[#1177bb] disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm font-medium text-white transition-colors"
    >
      {label} {stageLabel}
    </button>
  );
}

interface EditableFieldProps {
  label: string;
  value: string;
  isEditing: boolean;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
}

function EditableField({
  label,
  value,
  isEditing,
  onChange,
  multiline = false,
  placeholder = '',
}: EditableFieldProps) {
  if (isEditing) {
    if (multiline) {
      return (
        <div>
          <label className="block text-sm font-semibold text-gray-400 uppercase mb-2">
            {label}
          </label>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows={4}
            className="w-full bg-[#3c3c3c] border border-[#0e639c] rounded px-3 py-2 text-gray-200 resize-none focus:outline-none focus:ring-1 focus:ring-[#1177bb]"
          />
        </div>
      );
    }
    return (
      <div>
        <label className="block text-sm font-semibold text-gray-400 uppercase mb-2">
          {label}
        </label>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-[#3c3c3c] border border-[#0e639c] rounded px-3 py-2 text-gray-200 focus:outline-none focus:ring-1 focus:ring-[#1177bb]"
        />
      </div>
    );
  }

  return (
    <div className="bg-[#252526] rounded-lg p-4">
      <h2 className="text-sm font-semibold text-gray-400 uppercase mb-3">
        {label}
      </h2>
      <p className="text-gray-200 whitespace-pre-wrap">{value || '-'}</p>
    </div>
  );
}

export function TaskDetail() {
  const { taskId } = useParams<{ taskId: string }>();
  const { data: task, isLoading, error } = useTask(taskId!);
  const { data: eventsData } = useTaskEvents(taskId!);
  const dispatch = useDispatch();
  const cancelTask = useCancelTask();
  const completeAcceptance = useCompleteAcceptance();
  const updateTask = useUpdateTask();
  const [dispatching, setDispatching] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editObjective, setEditObjective] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const t = useTranslation();
  const { addNotification } = useNotifications();
  const queryClient = useQueryClient();

  // Initialize edit fields when task data is loaded
  useEffect(() => {
    if (task) {
      setEditTitle(task.title ?? '');
      setEditObjective(task.objective ?? '');
      setEditDescription(task.description ?? '');
    }
  }, [task]);

  // Clear success message after 3 seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  if (isLoading) return <LoadingPage />;
  if (error || !task) {
    return (
      <div className="p-8 text-center text-red-400">
        <AlertCircle className="h-8 w-8 mx-auto mb-2" />
        <p>{t.taskNotFound}</p>
        <Link to="/tasks" className="text-blue-400 hover:underline mt-2 block">
          {t.backToTasks}
        </Link>
      </div>
    );
  }

  const events = eventsData?.items ?? [];

  const handleDispatch = async (stage: string) => {
    setDispatching(stage);
    try {
      await dispatch.mutateAsync({ taskId: task.task_id ?? task.id, stage });
    } finally {
      setDispatching(null);
    }
  };

  const handleCancel = async () => {
    if (confirm(t.cancelConfirm)) {
      await cancelTask.mutateAsync(task.task_id ?? task.id);
    }
  };

  const handleCompleteAcceptance = async () => {
    await completeAcceptance.mutateAsync(task.task_id ?? task.id);
    setSuccessMessage(t.completeAcceptance);
  };

  const handleEdit = () => {
    setEditTitle(task.title ?? '');
    setEditObjective(task.objective ?? '');
    setEditDescription(task.description ?? '');
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditTitle(task.title ?? '');
    setEditObjective(task.objective ?? '');
    setEditDescription(task.description ?? '');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateTask.mutateAsync({
        taskId: task.task_id ?? task.id,
        data: {
          title: editTitle,
          objective: editObjective,
          description: editDescription,
        },
      });
      setIsEditing(false);
      setSuccessMessage(t.editSuccess);
    } catch (err) {
      // If API is not available (404), update locally as mock
      if (err instanceof Error && err.message.includes('404')) {
        // Optimistically update the cache
        const updatedTask: Task = {
          ...task,
          title: editTitle,
          objective: editObjective,
          description: editDescription,
        };
        queryClient.setQueryData(['task', taskId], updatedTask);
        setIsEditing(false);
        setSuccessMessage(t.apiNotAvailable);
      } else {
        console.error('Failed to update task:', err);
        addNotification({
          type: 'error',
          title: t.editError || 'Edit Error',
          message: t.editError || 'Failed to update task',
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const canDispatchPlan = task.state === 'queued';
  const canDispatchDev = task.state === 'planned' || task.state === 'rework_required';
  const canDispatchAcceptance = task.state === 'dev_completed';
  const canCancel = !['published', 'cancelled', 'failed'].includes(task.state);
  const canEdit = !isEditing && ['queued', 'planned', 'rework_required'].includes(task.state);
  const canCompleteAcceptance = !isEditing && task.state === 'accepting';

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-[#3c3c3c] bg-[#252526]">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Link to="/tasks" className="text-gray-400 hover:text-gray-200 flex-shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            {isEditing ? (
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder={t.titlePlaceholder}
                className="flex-1 bg-[#3c3c3c] border border-[#0e639c] rounded px-2 py-1 text-lg font-semibold text-white focus:outline-none focus:ring-1 focus:ring-[#1177bb] min-w-0"
              />
            ) : (
              <h1 className="text-lg font-semibold text-white truncate">{task.title ?? task.id}</h1>
            )}
          </div>
          {!isEditing && canEdit && (
            <button
              onClick={handleEdit}
              className="flex-shrink-0 ml-2 p-2 text-gray-400 hover:text-gray-200 hover:bg-[#3c3c3c] rounded transition-colors"
              title={t.edit}
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {isEditing && (
            <div className="flex-shrink-0 ml-2 flex items-center gap-2">
              <button
                onClick={handleCancelEdit}
                disabled={saving}
                className="p-2 text-gray-400 hover:text-red-400 hover:bg-[#3c3c3c] rounded transition-colors disabled:opacity-50"
                title={t.cancelEdit}
              >
                <X className="h-4 w-4" />
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="p-2 text-gray-400 hover:text-green-400 hover:bg-[#3c3c3c] rounded transition-colors disabled:opacity-50"
                title={t.save}
              >
                {saving ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StateBadge state={task.state} />
          <RiskBadge risk={task.risk_level ?? 'medium'} />
        </div>
        {successMessage && (
          <div className="mt-2 px-3 py-2 bg-green-900/50 border border-green-700 rounded text-green-300 text-sm flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            {successMessage}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left column - Details */}
          <div className="space-y-4">
            {/* Info card */}
            <div className="bg-[#252526] rounded-lg p-4">
              <h2 className="text-sm font-semibold text-gray-400 uppercase mb-3">
                {t.taskInfo}
              </h2>
              <dl className="space-y-2">
                <div className="flex justify-between">
                  <dt className="text-gray-500">ID</dt>
                  <dd className="text-gray-200 font-mono text-sm">{task.task_id ?? task.id}</dd>
                </div>
                {task.repo_ref && (
                  <>
                    <div className="flex justify-between">
                      <dt className="text-gray-500">{t.repo}</dt>
                      <dd className="text-gray-200">
                        <a
                          href={`https://github.com/${task.repo_ref.owner}/${task.repo_ref.name}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:underline flex items-center gap-1"
                        >
                          <GitBranch className="h-3 w-3" />
                          {task.repo_ref.owner}/{task.repo_ref.name}
                        </a>
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-gray-500">{t.branch}</dt>
                      <dd className="text-gray-200">{task.repo_ref.default_branch}</dd>
                    </div>
                  </>
                )}
                <div className="flex justify-between">
                  <dt className="text-gray-500">{t.version}</dt>
                  <dd className="text-gray-200">{task.version ?? '-'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">{t.created}</dt>
                  <dd className="text-gray-200">{formatDateTime(task.created_at ?? task.createdAt)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">{t.updated}</dt>
                  <dd className="text-gray-200">{formatDateTime(task.updated_at ?? task.updatedAt)}</dd>
                </div>
              </dl>
            </div>

            {/* Objective */}
            {isEditing ? (
              <div className="bg-[#252526] rounded-lg p-4">
                <EditableField
                  label={t.objective}
                  value={editObjective}
                  isEditing={isEditing}
                  onChange={setEditObjective}
                  multiline
                  placeholder={t.objectivePlaceholder}
                />
              </div>
            ) : (
              <EditableField
                label={t.objective}
                value={task.objective ?? ''}
                isEditing={false}
                onChange={() => {}}
              />
            )}

            {/* Description */}
            {isEditing ? (
              <div className="bg-[#252526] rounded-lg p-4">
                <EditableField
                  label={t.description}
                  value={editDescription}
                  isEditing={isEditing}
                  onChange={setEditDescription}
                  multiline
                  placeholder={t.descriptionPlaceholder}
                />
              </div>
            ) : task.description ? (
              <EditableField
                label={t.description}
                value={task.description}
                isEditing={false}
                onChange={() => {}}
              />
            ) : null}

            {/* Stats */}
            {(task.files_changed || task.lines_added || task.lines_deleted) && (
              <div className="bg-[#252526] rounded-lg p-4">
                <h2 className="text-sm font-semibold text-gray-400 uppercase mb-3">
                  {t.changes}
                </h2>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-gray-200">
                      {task.files_changed ?? 0}
                    </div>
                    <div className="text-xs text-gray-500">{t.filesChanged}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-400">
                      +{task.lines_added ?? 0}
                    </div>
                    <div className="text-xs text-gray-500">{t.linesAdded}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-red-400">
                      -{task.lines_deleted ?? 0}
                    </div>
                    <div className="text-xs text-gray-500">{t.linesDeleted}</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right column - Timeline & Actions */}
          <div className="space-y-4">
            {/* Actions */}
            <div className="bg-[#252526] rounded-lg p-4">
              <h2 className="text-sm font-semibold text-gray-400 uppercase mb-3">
                {t.actions}
              </h2>
              <div className="flex flex-wrap gap-2">
                <StageButton
                  stageLabel={getTranslatedStage('plan', t)}
                  disabled={!canDispatchPlan || dispatching === 'plan'}
                  onClick={() => handleDispatch('plan')}
                  label={t.dispatch}
                />
                <StageButton
                  stageLabel={getTranslatedStage('dev', t)}
                  disabled={!canDispatchDev || dispatching === 'dev'}
                  onClick={() => handleDispatch('dev')}
                  label={t.dispatch}
                />
                <StageButton
                  stageLabel={getTranslatedStage('acceptance', t)}
                  disabled={!canDispatchAcceptance || dispatching === 'acceptance'}
                  onClick={() => handleDispatch('acceptance')}
                  label={t.dispatch}
                />
                {canCompleteAcceptance && (
                  <button
                    onClick={handleCompleteAcceptance}
                    disabled={completeAcceptance.isPending}
                    className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm font-medium text-white transition-colors"
                  >
                    {completeAcceptance.isPending ? t.completingAcceptance : t.completeAcceptance}
                  </button>
                )}
                {canCancel && (
                  <button
                    onClick={handleCancel}
                    className="px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded text-sm font-medium text-white transition-colors"
                  >
                    <XCircle className="h-4 w-4 inline mr-1" />
                    {t.cancel}
                  </button>
                )}
              </div>
              {dispatching && (
                <div className="mt-2 text-sm text-gray-400 flex items-center gap-2">
                  <LoadingSpinner size="sm" />
                  {t.dispatch} {dispatching}...
                </div>
              )}
            </div>

            {/* Timeline */}
            <div className="bg-[#252526] rounded-lg p-4">
              <h2 className="text-sm font-semibold text-gray-400 uppercase mb-3 flex items-center gap-2">
                <Activity className="h-4 w-4" />
                {t.timeline}
              </h2>
              {events.length === 0 ? (
                <p className="text-gray-500 text-sm">{t.noEvents}</p>
              ) : (
                <div className="space-y-2">
                  {events.map((event) => (
                    (() => {
                      const reasonLabel = getTranslatedReason(event.reason, t) ?? event.reason;
                      const stateLabel = event.from_state === event.to_state
                        ? getTranslatedState(event.to_state, t)
                        : `${getTranslatedState(event.from_state, t)} → ${getTranslatedState(event.to_state, t)}`;

                      return (
                        <div
                          key={event.event_id}
                          className="flex items-start gap-2 text-sm"
                        >
                          <div className="mt-1">
                            {event.to_state === 'published' ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                            ) : event.to_state === 'failed' ||
                              event.to_state === 'cancelled' ? (
                              <XCircleIcon className="h-4 w-4 text-red-500" />
                            ) : (
                              <div className="h-4 w-4 rounded-full bg-blue-500" />
                            )}
                          </div>
                          <div>
                            <div className="text-gray-200">{stateLabel}</div>
                            {reasonLabel && (
                              <div className="text-gray-500 text-xs">
                                {reasonLabel}
                              </div>
                            )}
                            <div className="text-gray-600 text-xs">
                              {formatDateTime(event.occurred_at)}
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
