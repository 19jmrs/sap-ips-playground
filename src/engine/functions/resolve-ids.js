import { clone, fail, own } from '../util.js';

// Only looks up caller-supplied context.resolutions; no remote resolution is performed.
export const resolveIdFunctions = {
  resolveEntityIds: {
    run(value, config, ctx) {
      const type = config.entityType ?? 'user';
      const key = [config.sourceSystemName ?? '', config.targetSystemName ?? '', type].join('|');
      const table = ctx.env.resolutions?.[key] ?? ctx.env.resolutions?.[type];
      if (!table || !own(table, String(value))) {
        fail(`Missing supplied resolution for ${type} ID: ${String(value)} (context.resolutions)`);
      }
      return clone(table[String(value)]);
    },
  },
};
