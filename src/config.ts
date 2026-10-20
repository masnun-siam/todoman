export type Env = Record<string, string | undefined>;

export interface Config {
  tz: string;
  owner: string;
  enabled: boolean;
}

export function loadConfig(env: Env): Config {
  return {
    tz: env.TODOMAN_TZ || 'Asia/Dhaka',
    owner: env.TODOMAN_OWNER || 'masnun-siam',
    enabled: env.FEATURE_DUMP_TO_ISSUES === 'true', // exactly 'true'; 'TRUE', empty, unset = off
  };
}
