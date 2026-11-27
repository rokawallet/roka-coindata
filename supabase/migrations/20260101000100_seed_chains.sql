-- Chain registry defaults. Ethereum, Celo and Base are enabled; enable others via the admin API.
insert into public.chains
  (chain_id, name, slug, network_type, native_name, native_symbol, native_decimals,
   coingecko_platform_id, coingecko_native_id, geckoterminal_network_id, is_active)
values
  (1,      'Ethereum',            'ethereum',  'mainnet', 'Ether',        'ETH',  18, 'ethereum',              'ethereum',                'eth',          true),
  (42220,  'Celo',                'celo',      'mainnet', 'Celo',         'CELO', 18, 'celo',                  'celo',                    'celo',         true),
  (8453,   'Base',                'base',      'mainnet', 'Ether',        'ETH',  18, 'base',                  'ethereum',                'base',         true),
  (56,     'BNB Smart Chain',     'bsc',       'mainnet', 'BNB',          'BNB',  18, 'binance-smart-chain',   'binancecoin',             'bsc',          false),
  (137,    'Polygon',             'polygon',   'mainnet', 'POL',          'POL',  18, 'polygon-pos',           'polygon-ecosystem-token', 'polygon_pos',  false),
  (42161,  'Arbitrum One',        'arbitrum',  'mainnet', 'Ether',        'ETH',  18, 'arbitrum-one',          'ethereum',                'arbitrum',     false),
  (10,     'OP Mainnet',          'optimism',  'mainnet', 'Ether',        'ETH',  18, 'optimistic-ethereum',   'ethereum',                'optimism',     false),
  (43114,  'Avalanche C-Chain',   'avalanche', 'mainnet', 'Avalanche',    'AVAX', 18, 'avalanche',             'avalanche-2',             'avax',         false)
on conflict (chain_id) do nothing;
