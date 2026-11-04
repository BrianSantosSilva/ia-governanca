import { CsvConnector } from './csv/csv-connector.js';
import { GitHubCopilotSeatsConnector } from './external/github-copilot-seats-connector.js';
import { OpenAICostsConnector } from './external/openai-costs-connector.js';
import { defaultConnectorRegistry } from './registry.js';

export const SUPPORTED_DATASETS = ['api_costs', 'usage_records', 'license_assignments'] as const;
export type SupportedDataset = (typeof SUPPORTED_DATASETS)[number];

export * from './types.js';
export * from './registry.js';
export * from './csv/parser.js';
export * from './csv/csv-connector.js';

// Registra o conector CSV por padrão no registro de conectores
defaultConnectorRegistry.register(new CsvConnector());
defaultConnectorRegistry.register(new OpenAICostsConnector());
defaultConnectorRegistry.register(new GitHubCopilotSeatsConnector());

export * from './external/openai-costs-connector.js';
export * from './external/github-copilot-seats-connector.js';
