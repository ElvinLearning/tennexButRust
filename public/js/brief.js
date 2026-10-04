// Project brief presets and the `/brief` command (spec R8). Pure, no DOM.

export const PRESETS = {
  roblox: 'Roblox obby game for players aged 8-14, written in Luau. Ten short stages with checkpoints, a coin currency, '
    + 'a cosmetic shop and a global leaderboard. Must run well on phones and follow Roblox community standards.',
  cozy: 'Cozy farming and life-sim game for PC. Plant, water and harvest crops across four seasons, befriend six villagers, '
    + 'decorate a cottage. No combat, no fail states, soft pastel art, gentle music. Target: Steam, 12 months, team of 3.',
  higgsfield: 'Launch campaign for an AI video product using Higgsfield for video generation. Deliverables: a landing page, '
    + 'five 15-second vertical ad scripts with shot lists and prompts, a posting calendar, and an API integration plan '
    + 'for generating clips on demand.',
  wolf: 'Wolf-pack survival game. Players lead a pack through a harsh winter: hunt, defend territory from rival packs, '
    + 'raise pups and manage hunger and stamina. Third-person, stylised low-poly art, single player first, co-op later.',
};

/**
 * Interpret `/brief …`.
 * @returns {{brief?: string|null, message: string}|null} null if the text isn't a /brief command.
 *   `brief: null` clears; `brief` undefined means no change.
 */
export function briefCommand(text, current = '') {
  const m = text.trim().match(/^\/brief\b\s*([\s\S]*)$/i);
  if (!m) return null;
  const arg = m[1].trim();
  if (!arg) {
    return {
      message: current
        ? `Current brief: ${current}`
        : `No brief set. Use /brief <text>, or a preset: ${Object.keys(PRESETS).join(', ')}.`,
    };
  }
  if (/^(clear|none|off|reset)$/i.test(arg)) return { brief: null, message: 'Brief cleared.' };
  const preset = PRESETS[arg.toLowerCase()];
  if (preset) return { brief: preset, message: `Brief set to the “${arg.toLowerCase()}” preset.` };
  return { brief: arg, message: 'Brief set. Every agent will see it with every prompt.' };
}
