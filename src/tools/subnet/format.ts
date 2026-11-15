import { formatIpv4 } from './ipv4';

export const cidr = (network: number, prefix: number) => `${formatIpv4(network)}/${prefix}`;
