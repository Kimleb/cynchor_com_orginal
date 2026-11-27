export type RangeVulnId = 'sqli' | 'idor' | 'transfer_flaw' | 'hidden_admin';

export interface RangeLevelConfig {
  id: number;
  slug: string;
  name: string;
  difficulty: 'Introductory' | 'Intermediate' | 'Advanced' | 'Expert';
  vulnClass: string;
  description: string;
  enabledVulns: RangeVulnId[];
  initialVaultCents: number;
  durationSeconds: number;
  mitreTechniques: string[];
}

export const RANGE_LEVELS: RangeLevelConfig[] = [
  {
    id: 1,
    slug: 'open-vault',
    name: 'Open Vault',
    difficulty: 'Introductory',
    vulnClass: 'Login SQL Injection',
    description:
      'Bypass authentication via an unparameterized SQL login query and drain the synthetic vault before Blue patches the query.',
    enabledVulns: ['sqli'],
    initialVaultCents: 100_000_00,
    durationSeconds: 20 * 60,
    mitreTechniques: ['T1190'],
  },
  {
    id: 2,
    slug: 'wrong-door',
    name: 'Wrong Door',
    difficulty: 'Intermediate',
    vulnClass: 'SQLi + IDOR (/account/{id})',
    description:
      'Exploit missing object-level authorization on account endpoints to read and modify other synthetic customers’ balances.',
    enabledVulns: ['sqli', 'idor'],
    initialVaultCents: 100_000_00,
    durationSeconds: 15 * 60,
    mitreTechniques: ['T1190', 'T1078'],
  },
  {
    id: 3,
    slug: 'free-money',
    name: 'Free Money',
    difficulty: 'Advanced',
    vulnClass: 'SQLi + IDOR + Transfer Logic Flaw',
    description:
      'Abuse negative transfer amounts and missing balance checks to mint synthetic funds while Blue hardens validation.',
    enabledVulns: ['sqli', 'idor', 'transfer_flaw'],
    initialVaultCents: 100_000_00,
    durationSeconds: 12 * 60,
    mitreTechniques: ['T1190', 'T1078', 'T1565'],
  },
  {
    id: 4,
    slug: 'back-office',
    name: 'Back Office',
    difficulty: 'Expert',
    vulnClass: 'Chained Exploits + Hidden Admin Endpoint',
    description:
      'Discover and chain the unauthenticated hidden admin endpoint with prior flaws under a tight 10-minute match clock.',
    enabledVulns: ['sqli', 'idor', 'transfer_flaw', 'hidden_admin'],
    initialVaultCents: 100_000_00,
    durationSeconds: 10 * 60,
    mitreTechniques: ['T1190', 'T1078', 'T1565', 'T1098'],
  },
];

export function getRangeLevel(levelId: number): RangeLevelConfig | undefined {
  return RANGE_LEVELS.find((l) => l.id === levelId);
}

/**
 * Derive a PII-free player handle from the authenticated user record.
 * Never returns or logs an email address or real name.
 */
export function getPlayerHandle(user: { id: string; username?: string | null }): string {
  if (user.username && user.username.trim().length > 0) {
    return user.username.trim().toLowerCase();
  }
  return user.id;
}
