import type { DataConnector } from './types.js';

export class ConnectorRegistry {
  private connectors = new Map<string, DataConnector>();

  register(connector: DataConnector): void {
    const key = connector.provider.toLowerCase();
    this.connectors.set(key, connector);
  }

  get(provider: string): DataConnector | undefined {
    return this.connectors.get(provider.toLowerCase());
  }

  has(provider: string): boolean {
    return this.connectors.has(provider.toLowerCase());
  }

  list(): DataConnector[] {
    return Array.from(this.connectors.values());
  }

  unregister(provider: string): boolean {
    return this.connectors.delete(provider.toLowerCase());
  }

  clear(): void {
    this.connectors.clear();
  }
}

export const defaultConnectorRegistry = new ConnectorRegistry();
