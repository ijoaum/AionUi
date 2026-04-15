// tests/unit/team-agentSelectUtils.test.ts
import { describe, it, expect } from 'vitest';
import {
  resolveConversationType,
  filterTeamSupportedAgents,
  agentKey,
  agentFromKey,
  resolveTeamAgentType,
} from '@renderer/pages/team/components/agentSelectUtils';
import { isTeamCapableBackend, getTeamCapableBackends } from '@/common/types/teamTypes';
import { buildTeamMcpServer } from '@process/agent/acp/mcpSessionConfig';
import type { AvailableAgent } from '@renderer/utils/model/agentTypes';
import type { AcpInitializeResult } from '@/common/types/acpTypes';

// Helper to build a minimal cached AcpInitializeResult with mcpCapabilities.stdio = true
function makeCachedInit(backends: string[]): Record<string, AcpInitializeResult> {
  const result: Record<string, AcpInitializeResult> = {};
  for (const b of backends) {
    result[b] = {
      protocolVersion: 1,
      capabilities: {
        loadSession: false,
        promptCapabilities: { image: false, audio: false, embeddedContext: false },
        mcpCapabilities: { stdio: true, http: false, sse: false },
        sessionCapabilities: { fork: null, resume: null, list: null, close: null },
        _meta: {},
      },
      agentInfo: null,
      authMethods: [],
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// resolveConversationType
// ---------------------------------------------------------------------------
describe('resolveConversationType', () => {
  it('maps gemini to gemini', () => {
    expect(resolveConversationType('gemini')).toBe('gemini');
  });

  it('maps aionrs to aionrs', () => {
    expect(resolveConversationType('aionrs')).toBe('aionrs');
  });

  it('maps codex to acp (MCP injectable)', () => {
    expect(resolveConversationType('codex')).toBe('acp');
  });

  it('maps openclaw-gateway to openclaw-gateway', () => {
    expect(resolveConversationType('openclaw-gateway')).toBe('openclaw-gateway');
  });

  it('maps nanobot to nanobot', () => {
    expect(resolveConversationType('nanobot')).toBe('nanobot');
  });

  it('maps remote to remote', () => {
    expect(resolveConversationType('remote')).toBe('remote');
  });

  it.each(['claude', 'qwen', 'deepseek', 'grok', 'some-future-acp-backend'])(
    'maps unknown backend "%s" to acp (default, MCP injectable)',
    (backend) => {
      expect(resolveConversationType(backend)).toBe('acp');
    }
  );
});

// isTeamCapableBackend — tests against the actual TEAM_SUPPORTED_BACKENDS set
describe('isTeamSupportedBackend', () => {
  it.each(['claude', 'codex', 'gemini', 'qwen'])('allows verified backend "%s"', (backend) => {
    expect(isTeamCapableBackend(backend, null)).toBe(true);
  });

  it.each(['codebuddy', 'aionrs', 'openclaw-gateway', 'nanobot', 'remote', 'copilot', 'kimi', 'goose'])(
    'rejects unverified backend "%s"',
    (backend) => {
      expect(isTeamCapableBackend(backend, null)).toBe(false);
    }
  );
});

// ---------------------------------------------------------------------------
// filterTeamSupportedAgents
// ---------------------------------------------------------------------------
describe('filterTeamSupportedAgents', () => {
  const makeAgent = (backend: string, overrides?: Partial<AvailableAgent>): AvailableAgent =>
    ({
      backend,
      name: backend,
      conversationType: 'acp',
      ...overrides,
    }) as AvailableAgent;

  const cached = makeCachedInit(['claude', 'codex']);

  it('keeps verified backends (via TEAM_SUPPORTED_BACKENDS) even without cache', () => {
    const agents = [
      makeAgent('claude'),
      makeAgent('gemini'),
      makeAgent('codex'),
      makeAgent('qwen'),
      makeAgent('codebuddy'),
    ];
    // Without cached init results, only TEAM_SUPPORTED_BACKENDS entries pass
    const result = filterTeamSupportedAgents(agents, null);
    expect(result.map((a: AvailableAgent) => a.backend)).toEqual(['claude', 'gemini', 'codex', 'qwen']);
  });

  it('uses presetAgentType over backend when available', () => {
    const agent = makeAgent('claude', { presetAgentType: 'codebuddy' });
    const result = filterTeamSupportedAgents([agent], null);
    expect(result).toHaveLength(0);
  });

  it('returns empty array when no agents are supported', () => {
    const agents = [makeAgent('codebuddy'), makeAgent('remote'), makeAgent('kimi')];
    expect(filterTeamSupportedAgents(agents, null)).toEqual([]);
  });

  it('returns agents from cache + hardcoded list when both are available', () => {
    const agents = [makeAgent('claude'), makeAgent('codex'), makeAgent('qwen')];
    expect(filterTeamSupportedAgents(agents, cached)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// agentKey / agentFromKey
// ---------------------------------------------------------------------------
describe('agentKey', () => {
  it('returns cli:: prefix for CLI agents', () => {
    expect(agentKey({ backend: 'claude' } as AvailableAgent)).toBe('cli::claude');
  });

  it('returns preset:: prefix for custom agents', () => {
    expect(agentKey({ backend: 'claude', customAgentId: 'my-agent' } as AvailableAgent)).toBe('preset::my-agent');
  });
});

describe('agentFromKey', () => {
  const agents = [
    { backend: 'claude' } as AvailableAgent,
    { backend: 'claude', customAgentId: 'my-agent' } as AvailableAgent,
  ];

  it('finds CLI agent by key', () => {
    expect(agentFromKey('cli::claude', agents)).toBe(agents[0]);
  });

  it('finds preset agent by key', () => {
    expect(agentFromKey('preset::my-agent', agents)).toBe(agents[1]);
  });

  it('returns undefined for unknown key', () => {
    expect(agentFromKey('cli::unknown', agents)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolveTeamAgentType
// ---------------------------------------------------------------------------
describe('resolveTeamAgentType', () => {
  it('returns presetAgentType when available', () => {
    expect(resolveTeamAgentType({ presetAgentType: 'qwen' } as AvailableAgent, 'fallback')).toBe('qwen');
  });

  it('falls back to backend when no presetAgentType', () => {
    expect(resolveTeamAgentType({ backend: 'claude' } as AvailableAgent, 'fallback')).toBe('claude');
  });

  it('returns fallback when agent is undefined', () => {
    expect(resolveTeamAgentType(undefined, 'fallback')).toBe('fallback');
  });
});

// ---------------------------------------------------------------------------
// Frontend ↔ Backend consistency: ensure MCP injection chain is aligned
// ---------------------------------------------------------------------------
describe('MCP injection chain consistency', () => {
  it('every verified backend must resolve to a MCP_CAPABLE_TYPE', () => {
    for (const backend of TEAM_SUPPORTED_BACKENDS) {
      const convType = resolveConversationType(backend);
      expect(
        MCP_CAPABLE_TYPES.has(convType),
        `Verified backend "${backend}" (→ "${convType}") but backend MCP_CAPABLE_TYPES does not include "${convType}"`
      ).toBe(true);
    }
  });

  it('TEAM_SUPPORTED_BACKENDS contains exactly claude, codex, gemini, qwen', () => {
    expect([...TEAM_SUPPORTED_BACKENDS].toSorted()).toEqual(['claude', 'codex', 'gemini', 'qwen']);
  });

  it('MCP_CAPABLE_TYPES contains "acp" — the core team protocol', () => {
    expect(MCP_CAPABLE_TYPES.has('acp')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildTeamMcpServer — the actual injection builder used by AcpAgent
// ---------------------------------------------------------------------------
describe('buildTeamMcpServer', () => {
  const validConfig = {
    name: 'team-mcp',
    command: '/usr/bin/node',
    args: ['server.js', '--team-id=abc'],
    env: [{ name: 'TEAM_ID', value: 'abc' }],
  };

  it('returns a valid stdio server entry when config is complete', () => {
    const result = buildTeamMcpServer(validConfig);
    expect(result).toEqual({
      name: 'team-mcp',
      command: '/usr/bin/node',
      args: ['server.js', '--team-id=abc'],
      env: [{ name: 'TEAM_ID', value: 'abc' }],
    });
  });

  it('returns null when config is undefined', () => {
    expect(buildTeamMcpServer(undefined)).toBeNull();
  });

  it('returns null when config is null', () => {
    expect(buildTeamMcpServer(null)).toBeNull();
  });

  it('returns null when command is empty string', () => {
    expect(buildTeamMcpServer({ ...validConfig, command: '' })).toBeNull();
  });

  it('preserves all env entries', () => {
    const config = {
      ...validConfig,
      env: [
        { name: 'TEAM_ID', value: 'abc' },
        { name: 'SLOT_ID', value: 'slot-1' },
      ],
    };
    const result = buildTeamMcpServer(config);
    expect(result?.env).toHaveLength(2);
    expect(result?.env[1]).toEqual({ name: 'SLOT_ID', value: 'slot-1' });
  });

  it('preserves empty args array', () => {
    const result = buildTeamMcpServer({ ...validConfig, args: [] });
    expect(result?.args).toEqual([]);
  });
});
