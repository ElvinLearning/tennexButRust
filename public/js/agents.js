// The five agents. Names, roles and monitor styles; system prompts live on the server.

export const AGENTS = [
  { id: 'tenx', name: 'Tenx', role: 'Lead Engineer', screen: 'code', color: 0x4f8cff, hair: 0x2b2118, skin: 0xe0b08c,
    aliases: ['tenx', '10x', 'ten x', 'ten ex', 'tennex', 'tenex'] },
  { id: 'assert', name: 'Assert', role: 'QA Engineer', screen: 'tests', color: 0x3ecf8e, hair: 0x111111, skin: 0x8d5a3b,
    verb: true, aliases: ['assert'] },
  { id: 'vector', name: 'Vector', role: 'Product Lead', screen: 'plan', color: 0xf5a524, hair: 0xb5562b, skin: 0xf1c7a5,
    aliases: ['vector'] },
  { id: 'deploy', name: 'Deploy', role: 'Platform Engineer', screen: 'terminal', color: 0xa78bfa, hair: 0x3a3a3a, skin: 0xc68e62,
    verb: true, aliases: ['deploy'] },
  { id: 'critic', name: 'Critic', role: 'Principal Reviewer', screen: 'diff', color: 0xf0506e, hair: 0xd8d8d8, skin: 0xe8b894,
    aliases: ['critic'] },
];

export const byId = Object.fromEntries(AGENTS.map((a) => [a.id, a]));
