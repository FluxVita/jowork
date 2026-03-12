export type SourceType = 'github' | 'gitlab' | 'figma' | 'feishu' | 'local-folder';

export interface DataSource {
  id: string;
  type: SourceType;
  name: string;
  config: ConnectorConfig;
  status: 'active' | 'error' | 'disconnected';
  lastSyncAt?: Date;
  createdAt: Date;
}

export interface ConnectorConfig {
  [key: string]: unknown;
}
