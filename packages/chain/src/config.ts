/** Ids of a published `quits` Move package. */
export interface QuitsChainConfig {
  pkg: string;
  /** Shared `quits::settle::Config` object. */
  configId: string;
  /** Coin type `C` the Move calls are instantiated with (USDC on mainnet). */
  usdcType: string;
}

export type SuiNetwork = 'mainnet' | 'testnet' | 'localnet';

export const USDC_MAINNET = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
export const USDC_TESTNET = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';
export const SUI_TYPE = '0x2::sui::SUI';

export const TATUM_GRPC_HOST: Record<Exclude<SuiNetwork, 'localnet'>, string> = {
  mainnet: 'sui-mainnet-grpc.gateway.tatum.io:443',
  testnet: 'sui-testnet-grpc.gateway.tatum.io:443',
};

export const TATUM_GRAPHQL_URL: Record<Exclude<SuiNetwork, 'localnet'>, string> = {
  mainnet: 'https://sui-mainnet.gateway.tatum.io/graphql',
  testnet: 'https://sui-testnet.gateway.tatum.io/graphql',
};

export const TATUM_API_URL = 'https://api.tatum.io';

export const LOCALNET_RPC_URL = 'http://127.0.0.1:9000';
export const LOCALNET_GRAPHQL_URL = 'http://127.0.0.1:9125/graphql';
export const LOCALNET_FAUCET_URL = 'http://127.0.0.1:9123';
