import React, { useEffect, useRef, useState } from 'react';
import { Button, Form, Input, Message, Select, Tag, Tooltip } from '@arco-design/web-react';
import type { RefInputType } from '@arco-design/web-react/es/Input/interface';
import { FolderOpen, Close, Robot, Folder, FolderPlus, Check, Down, Plus, Delete, Edit } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { ConfigStorage } from '@/common/config/storage';
import type { AcpInitializeResult } from '@/common/types/acpTypes';
import type { TTeam, TeamAgent } from '@/common/types/teamTypes';
import type { AvailableAgent } from '@renderer/utils/model/agentTypes';
import { getAgentLogo } from '@renderer/utils/model/agentLogo';
import { CUSTOM_AVATAR_IMAGE_MAP } from '@renderer/pages/guid/constants';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { useConversationAgents } from '@renderer/pages/conversation/hooks/useConversationAgents';
import { isElectronDesktop } from '@renderer/utils/platform';
import AionModal from '@renderer/components/base/AionModal';
import {
  agentKey,
  agentFromKey,
  resolveConversationType,
  resolveTeamAgentType,
  filterTeamSupportedAgents,
} from './agentSelectUtils';

const FormItem = Form.Item;

const RECENT_WS_KEY = 'aionui:recent-workspaces';

const getRecentWorkspaces = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_WS_KEY) ?? '[]');
  } catch {
    return [];
  }
};

const addRecentWorkspace = (path: string) => {
  try {
    const prev = getRecentWorkspaces();
    const next = [path, ...prev.filter((p) => p !== path)].slice(0, 5);
    localStorage.setItem(RECENT_WS_KEY, JSON.stringify(next));
  } catch {}
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onCreated: (team: TTeam) => void;
};

const AgentCardIcon: React.FC<{ agent: AvailableAgent }> = ({ agent }) => {
  const logo = getAgentLogo(agent.backend);
  const avatarImage = agent.avatar ? CUSTOM_AVATAR_IMAGE_MAP[agent.avatar] : undefined;
  const isEmoji = agent.avatar && !avatarImage && !agent.avatar.endsWith('.svg');

  if (avatarImage)
    return <img src={avatarImage} alt={agent.name} style={{ width: 32, height: 32, objectFit: 'contain' }} />;
  if (isEmoji) return <span style={{ fontSize: 24, lineHeight: '32px' }}>{agent.avatar}</span>;
  if (logo) return <img src={logo} alt={agent.name} style={{ width: 32, height: 32, objectFit: 'contain' }} />;
  return <Robot size='32' />;
};

// Common emojis for agent icons
const AGENT_EMOJIS = [
  '🤖', '🧠', '💻', '🔧', '📊', '🎨', '📝', '🔍', '⚡', '🛡️',
  '🎯', '🚀', '💡', '🧪', '📋', '🏗️', '🔬', '📐', '🗂️', '🔗',
];

const TEAM_ROLES = [
  { value: 'Developer', label: 'Developer', desc: 'Implement features and fix bugs' },
  { value: 'Reviewer', label: 'Reviewer', desc: 'Review code and suggest improvements' },
  { value: 'Tester', label: 'Tester', desc: 'Write and run tests' },
  { value: 'Architect', label: 'Architect', desc: 'Design system architecture' },
  { value: 'Researcher', label: 'Researcher', desc: 'Research and gather information' },
  { value: 'Writer', label: 'Writer', desc: 'Write documentation and content' },
  { value: 'Coordinator', label: 'Coordinator', desc: 'Coordinate team activities' },
  { value: 'Custom', label: 'Custom', desc: 'Define your own role' },
];

interface TeamMemberDraft {
  name: string;
  icon: string;
  role: string;
  identity: string;
  backendKey: string | undefined;
}

const TeamCreateModal: React.FC<Props> = ({ visible, onClose, onCreated }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { cliAgents } = useConversationAgents();
  const [name, setName] = useState('');
  const [dispatchAgentKey, setDispatchAgentKey] = useState<string | undefined>(undefined);
  const [workspace, setWorkspace] = useState('');
  const [loading, setLoading] = useState(false);
  const [wsDropdownVisible, setWsDropdownVisible] = useState(false);
  const [members, setMembers] = useState<TeamMemberDraft[]>([]);
  const [showMemberForm, setShowMemberForm] = useState(false);
  const [editingMemberIdx, setEditingMemberIdx] = useState<number | null>(null);
  const [memberForm, setMemberForm] = useState<TeamMemberDraft>({
    name: '',
    icon: '🤖',
    role: 'Developer',
    identity: '',
    backendKey: undefined,
  });
  const nameInputRef = useRef<RefInputType | null>(null);
  const [cachedInitResults, setCachedInitResults] = useState<Record<string, AcpInitializeResult> | null>(null);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    ConfigStorage.get('acp.cachedInitializeResult')
      .then((data) => {
        if (active) setCachedInitResults(data ?? null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [visible]);

  const allAgents = filterTeamSupportedAgents([...cliAgents], cachedInitResults);

  useEffect(() => {
    if (visible) {
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [visible]);

  const handleClose = () => {
    setName('');
    setDispatchAgentKey(undefined);
    setWorkspace('');
    setMembers([]);
    setShowMemberForm(false);
    setEditingMemberIdx(null);
    setMemberForm({ name: '', icon: '🤖', role: 'Developer', identity: '', backendKey: undefined });
    setWsDropdownVisible(false);
    onClose();
  };

  const handleBrowseWorkspace = async () => {
    setWsDropdownVisible(false);
    const files = await ipcBridge.dialog.showOpen.invoke({ properties: ['openDirectory'] });
    if (files?.[0]) {
      setWorkspace(files[0]);
      addRecentWorkspace(files[0]);
    }
  };

  const handleSelectRecentWorkspace = (path: string) => {
    setWorkspace(path);
    addRecentWorkspace(path);
    setWsDropdownVisible(false);
  };

  const handleAddMember = () => {
    if (!memberForm.name.trim()) {
      Message.warning('Please enter a member name');
      return;
    }
    if (!memberForm.backendKey) {
      Message.warning('Please select an agent type');
      return;
    }
    if (editingMemberIdx !== null) {
      const updated = [...members];
      updated[editingMemberIdx] = { ...memberForm };
      setMembers(updated);
      setEditingMemberIdx(null);
    } else {
      setMembers([...members, { ...memberForm }]);
    }
    setMemberForm({ name: '', icon: '🤖', role: 'Developer', identity: '', backendKey: undefined });
    setShowMemberForm(false);
  };

  const handleEditMember = (idx: number) => {
    setMemberForm({ ...members[idx] });
    setEditingMemberIdx(idx);
    setShowMemberForm(true);
  };

  const handleRemoveMember = (idx: number) => {
    setMembers(members.filter((_, i) => i !== idx));
    if (editingMemberIdx === idx) {
      setEditingMemberIdx(null);
      setShowMemberForm(false);
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      Message.warning(t('team.create.nameRequired', { defaultValue: 'Please enter a team name' }));
      nameInputRef.current?.focus();
      return;
    }
    if (!dispatchAgentKey) {
      Message.warning(t('team.create.leaderRequired', { defaultValue: 'Please select a team leader' }));
      return;
    }
    const userId = user?.id ?? 'system_default_user';
    setLoading(true);
    try {
      const agents: TeamAgent[] = [];

      const dispatchAgent = dispatchAgentKey ? agentFromKey(dispatchAgentKey, allAgents) : undefined;
      const dispatchAgentType = resolveTeamAgentType(dispatchAgent, 'acp');
      agents.push({
        slotId: '',
        conversationId: '',
        role: 'lead',
        status: 'pending',
        agentType: dispatchAgentType,
        agentName: 'Leader',
        conversationType: resolveConversationType(dispatchAgentType),
        cliPath: dispatchAgent?.cliPath,
        customAgentId: dispatchAgent?.customAgentId,
        agentIcon: '👑',
        agentRole: 'Team Leader',
        agentIdentity: '',
      });

      // Add team members
      for (const member of members) {
        const mAgent = member.backendKey ? agentFromKey(member.backendKey, allAgents) : undefined;
        const mAgentType = resolveTeamAgentType(mAgent, 'acp');
        agents.push({
          slotId: '',
          conversationId: '',
          role: 'teammate',
          status: 'pending',
          agentType: mAgentType,
          agentName: member.name,
          conversationType: resolveConversationType(mAgentType),
          cliPath: mAgent?.cliPath,
          customAgentId: mAgent?.customAgentId,
          agentIcon: member.icon,
          agentRole: member.role,
          agentIdentity: member.identity,
        });
      }

      const team = await ipcBridge.team.create.invoke({
        userId,
        name,
        workspace,
        workspaceMode: 'shared',
        agents,
      });

      const result = team as unknown as { __bridgeError?: boolean; message?: string };
      if (result.__bridgeError) {
        Message.error(result.message ?? t('team.create.error', { defaultValue: 'Failed to create team' }));
        return;
      }

      onCreated(team);
      handleClose();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      Message.error(msg || t('team.create.error', { defaultValue: 'Failed to create team' }));
    } finally {
      setLoading(false);
    }
  };

  const folderName = workspace ? workspace.split(/[\\/]/).pop() || workspace : '';
  const selectedLeader = dispatchAgentKey ? agentFromKey(dispatchAgentKey, allAgents) : undefined;

  return (
    <AionModal
      visible={visible}
      onCancel={handleClose}
      className='team-create-modal'
      style={{ width: 640 }}
      wrapStyle={{ zIndex: 10000 }}
      maskStyle={{ zIndex: 9999 }}
      autoFocus={false}
      unmountOnExit={false}
      contentStyle={{
        background: 'var(--dialog-fill-0)',
        maxHeight: 'min(80vh, 720px)',
        overflow: 'auto',
      }}
      header={{
        render: () => (
          <div className='flex items-center justify-between border-b border-border-1 bg-dialog-fill-0 px-24px py-20px'>
            <h3 className='m-0 text-18px font-500 text-t-primary'>
              {t('team.create.title', { defaultValue: 'Create Team' })}
            </h3>
            <Button
              type='text'
              icon={<Close size='20' fill='currentColor' className='text-t-secondary' />}
              onClick={handleClose}
              className='!h-32px !w-32px !min-w-32px !p-0 !rd-8px hover:!bg-fill-1'
            />
          </div>
        ),
      }}
      footer={
        <div className='flex justify-end gap-10px border-t border-border-1 bg-dialog-fill-0 px-24px py-20px'>
          <Button onClick={handleClose} className='min-w-88px' style={{ borderRadius: 8 }}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            type='primary'
            onClick={handleCreate}
            loading={loading}
            className='min-w-88px'
            style={{ borderRadius: 8 }}
          >
            {t('team.create.confirm', { defaultValue: 'Create Team' })}
            {members.length > 0 && ` (${1 + members.length} agents)`}
          </Button>
        </div>
      }
    >
      <div className='px-24px py-20px'>
        <Form layout='vertical'>
          {/* Team name */}
          <FormItem label={t('team.create.namePlaceholder', { defaultValue: 'Team name' })} required>
            <Input
              ref={nameInputRef}
              placeholder={t('team.create.namePlaceholder', { defaultValue: 'My Awesome Team' })}
              value={name}
              onChange={setName}
            />
          </FormItem>

          {/* Team Leader */}
          <FormItem label={t('team.create.step.dispatch', { defaultValue: 'Team Leader' })} required>
            <div className='flex flex-col gap-8px'>
              <span className='text-12px leading-18px text-t-secondary'>
                {t('team.create.leaderDesc', {
                  defaultValue: 'Receives your instructions, breaks down the task, and assigns work to team agents',
                })}
              </span>
              {allAgents.length === 0 ? (
                <div className='flex items-center justify-center rounded-12px border border-dashed border-border-2 bg-fill-1 py-20px text-12px text-t-secondary'>
                  {t('team.create.noSupportedAgents', { defaultValue: 'No supported agents installed' })}
                </div>
              ) : (
                <div className='grid gap-8px' style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                  {allAgents.map((agent) => {
                    const key = agentKey(agent);
                    const isSelected = dispatchAgentKey === key;
                    return (
                      <div
                        key={key}
                        data-testid={`team-create-agent-card-${key}`}
                        onClick={() => setDispatchAgentKey(isSelected ? undefined : key)}
                        className={`flex flex-col items-center gap-6px px-8px py-10px rd-10px cursor-pointer transition-all border shadow-sm ${
                          isSelected
                            ? 'relative border-2 border-primary-5 bg-fill-2'
                            : 'border-border-2 bg-fill-1 hover:border-border-1 hover:bg-fill-2'
                        }`}
                      >
                        {isSelected && (
                          <span
                            data-testid={`team-create-agent-selected-badge-${key}`}
                            className='absolute right-6px top-6px flex h-16px w-16px items-center justify-center rounded-full bg-primary-6 text-white shadow-sm'
                          >
                            <Check size='10' fill='currentColor' className='shrink-0' />
                          </span>
                        )}
                        <AgentCardIcon agent={agent} />
                        <span className='w-full truncate text-center text-12px leading-16px text-t-primary'>
                          {agent.name}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </FormItem>

          {/* Team Members */}
          <FormItem
            label={
              <div className='flex items-center gap-6px'>
                {t('team.create.members', { defaultValue: 'Team Members' })}
                <span className='text-xs font-normal text-t-tertiary'>
                  ({t('common.optional', { defaultValue: 'optional' })})
                </span>
              </div>
            }
          >
            {/* Member list */}
            {members.length > 0 && (
              <div className='mb-12px flex flex-col gap-8px'>
                {members.map((member, idx) => (
                  <div
                    key={idx}
                    className='flex items-center gap-12px rounded-10px border border-border-2 bg-fill-1 px-14px py-10px'
                  >
                    <span className='text-20px'>{member.icon}</span>
                    <div className='flex-1 min-w-0'>
                      <div className='text-14px font-500 text-t-primary'>{member.name}</div>
                      <div className='text-12px text-t-secondary'>{member.role}</div>
                    </div>
                    {member.backendKey && (
                      <Tag color='arcoblue' size='small'>
                        {agentFromKey(member.backendKey, allAgents)?.name || member.backendKey}
                      </Tag>
                    )}
                    <div className='flex gap-4px'>
                      <Button
                        type='text'
                        size='mini'
                        icon={<Edit size='14' />}
                        onClick={() => handleEditMember(idx)}
                      />
                      <Button
                        type='text'
                        size='mini'
                        icon={<Delete size='14' />}
                        onClick={() => handleRemoveMember(idx)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Member form */}
            {showMemberForm ? (
              <div className='rounded-10px border border-border-2 bg-fill-1 p-14px'>
                <div className='mb-12px text-14px font-500 text-t-primary'>
                  {editingMemberIdx !== null ? 'Edit Member' : 'Add Member'}
                </div>

                <div className='mb-10px grid grid-cols-2 gap-10px'>
                  {/* Name */}
                  <div>
                    <label className='mb-4px block text-12px text-t-secondary'>Name</label>
                    <Input
                      placeholder='Agent name'
                      value={memberForm.name}
                      onChange={(v) => setMemberForm({ ...memberForm, name: v })}
                    />
                  </div>

                  {/* Role */}
                  <div>
                    <label className='mb-4px block text-12px text-t-secondary'>Role</label>
                    <Select
                      value={memberForm.role}
                      onChange={(v) => setMemberForm({ ...memberForm, role: v })}
                      triggerProps={{ className: '!w-full' }}
                    >
                      {TEAM_ROLES.map((r) => (
                        <Select.Option key={r.value} value={r.value}>
                          {r.label}
                        </Select.Option>
                      ))}
                    </Select>
                    {memberForm.role === 'Custom' && (
                      <Input
                        className='mt-6px'
                        placeholder='Enter custom role'
                        value={memberForm.role === 'Custom' ? '' : memberForm.role}
                        onChange={(v) => setMemberForm({ ...memberForm, role: v || 'Custom' })}
                      />
                    )}
                  </div>
                </div>

                {/* Icon picker */}
                <div className='mb-10px'>
                  <label className='mb-4px block text-12px text-t-secondary'>Icon</label>
                  <div className='flex flex-wrap gap-6px'>
                    {AGENT_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type='button'
                        onClick={() => setMemberForm({ ...memberForm, icon: emoji })}
                        className={`flex h-36px w-36px items-center justify-center rounded-8px border text-18px transition-all ${
                          memberForm.icon === emoji
                            ? 'border-primary-5 bg-fill-2 shadow-sm'
                            : 'border-border-2 hover:border-border-1 hover:bg-fill-2'
                        }`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Backend type */}
                <div className='mb-10px'>
                  <label className='mb-4px block text-12px text-t-secondary'>Agent Type</label>
                  <div className='grid gap-6px' style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                    {allAgents.map((agent) => {
                      const key = agentKey(agent);
                      const isSelected = memberForm.backendKey === key;
                      return (
                        <div
                          key={key}
                          onClick={() => setMemberForm({ ...memberForm, backendKey: key })}
                          className={`flex items-center gap-6px rounded-8px border px-10px py-6px cursor-pointer transition-all ${
                            isSelected
                              ? 'border-primary-5 bg-fill-2'
                              : 'border-border-2 hover:border-border-1'
                          }`}
                        >
                          <AgentCardIcon agent={agent} />
                          <span className='truncate text-12px text-t-primary'>{agent.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Identity */}
                <div className='mb-12px'>
                  <label className='mb-4px block text-12px text-t-secondary'>
                    Identity / System Prompt
                    <span className='ml-4px text-t-tertiary'>({t('common.optional', { defaultValue: 'optional' })})</span>
                  </label>
                  <Input.TextArea
                    placeholder='e.g. You are a senior TypeScript expert. You always write clean, type-safe code with thorough error handling.'
                    value={memberForm.identity}
                    onChange={(v) => setMemberForm({ ...memberForm, identity: v })}
                    autoSize={{ minRows: 2, maxRows: 4 }}
                  />
                </div>

                {/* Actions */}
                <div className='flex justify-end gap-8px'>
                  <Button
                    size='small'
                    onClick={() => {
                      setShowMemberForm(false);
                      setEditingMemberIdx(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button size='small' type='primary' onClick={handleAddMember}>
                    {editingMemberIdx !== null ? 'Update' : 'Add Member'}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type='dashed'
                icon={<Plus size='16' />}
                onClick={() => {
                  setMemberForm({ name: '', icon: '🤖', role: 'Developer', identity: '', backendKey: undefined });
                  setEditingMemberIdx(null);
                  setShowMemberForm(true);
                }}
                className='w-full'
              >
                {members.length === 0
                  ? 'Add team members'
                  : `Add another member (${members.length} already added)`}
              </Button>
            )}
          </FormItem>

          {/* Workspace */}
          <FormItem
            label={
              <>
                {t('team.create.step.workspace', { defaultValue: 'Workspace' })}
                <span className='ml-4px text-xs font-normal text-t-tertiary'>
                  {t('common.optional', { defaultValue: '(optional)' })}
                </span>
              </>
            }
          >
            <div className='flex gap-8px'>
              <Input
                value={workspace}
                onChange={setWorkspace}
                placeholder={t('team.create.workspacePlaceholder', { defaultValue: 'Workspace path (optional)' })}
              />
              <Button icon={<Folder size='16' />} onClick={handleBrowseWorkspace} data-testid='team-create-workspace-trigger'>
                {t('common.browse', { defaultValue: 'Browse' })}
              </Button>
            </div>
          </FormItem>
        </Form>
      </div>
    </AionModal>
  );
};

export default TeamCreateModal;
