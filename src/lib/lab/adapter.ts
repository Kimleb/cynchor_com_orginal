import { LabLaunchConfig, LabLaunchResult } from '@/types';

// The current Cynchor lab adapter returns simulation metadata.
const enableStubMode = process.env.CYNCHOR_LAB_STUB_MODE !== 'false';

export async function launchLab(config: LabLaunchConfig): Promise<LabLaunchResult> {
  const { sessionId, mode, side = 'SOLO' } = config;

  // Log adapter call for operator auditing
  console.log(`[LabAdapter] launchLab invoked - sessionId: ${sessionId}, mode: ${mode}, side: ${side}`);

  // Configurable stub behavior:
  if (enableStubMode) {
    let subnet = '10.240.10.0/24';
    let gateway = '10.240.10.1';

    if (mode === 'TEAM') {
      if (side === 'RED') {
        subnet = '10.240.100.0/24 (Red Offensive Segment)';
        gateway = '10.240.100.1';
      } else if (side === 'BLUE') {
        subnet = '10.240.200.0/24 (Blue Defensive Segment)';
        gateway = '10.240.200.1';
      }
    }

    return {
      status: 'STUBBED',
      sessionId,
      mode,
      side,
      allocatedSubnet: subnet,
      gatewayIp: gateway,
      targetDomain: 'fintechcorp.local',
      endpointUrl: null, // No live console endpoint is configured
      isLiveLabConnected: false,
      adapterMessage: 'The Cynchor lab adapter is running in simulation mode.',
    };
  }

  // Return simulation metadata until live provisioning is available.
  return {
    status: 'STUBBED',
    sessionId,
    mode,
    side,
    allocatedSubnet: '10.240.10.0/24',
    gatewayIp: '10.240.10.1',
    targetDomain: 'fintechcorp.local',
    endpointUrl: null,
    isLiveLabConnected: false,
    adapterMessage: 'Live lab provisioning is pending. The Cynchor range is running in simulation mode.',
  };
}

