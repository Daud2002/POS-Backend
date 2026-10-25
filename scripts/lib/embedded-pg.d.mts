export interface EmbeddedPostgresHandle {
  config: { host: string; port: number; username: string; password: string; database: string };
  createDatabase(name: string): Promise<void>;
  stop(): Promise<void>;
}

export function startEmbeddedPostgres(options: {
  port: number;
  database?: string;
}): Promise<EmbeddedPostgresHandle>;
