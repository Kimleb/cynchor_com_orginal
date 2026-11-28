export const TEAM_SIZE = 3;

export function demoTeamPath(id: string | null | undefined) {
  return id && /^team_[a-z0-9_-]{1,80}$/i.test(id)
    ? '/demo/team?invite=' + encodeURIComponent(id)
    : '/demo/team';
}

export const RULES_VERSION = 'fintech-roe-v1';
