import { IClusterOptions } from "../cluster/ClusterOptions";
import { ICommanderOptions } from "../commander";
import AbstractConnector from "../connectors/AbstractConnector";
import { ISentinelConnectionOptions } from "../connectors/SentinelConnector";

export type ReconnectOnError = (err: Error) => boolean | 1 | 2;

export interface IRedisOptions
  extends Partial<ISentinelConnectionOptions>,
    Partial<ICommanderOptions>,
    Partial<IClusterOptions> {
  Connector?: typeof AbstractConnector;
  retryStrategy?: (times: number) => number | void | null;
  commandTimeout?: number;
  keepAlive?: number;
  noDelay?: boolean;
  connectionName?: string;
  username?: string;
  password?: string;
  db?: number;
  dropBufferSupport?: boolean;
  autoResubscribe?: boolean;
  autoResendUnfulfilledCommands?: boolean;
  keyPrefix?: string;
  reconnectOnError?: ReconnectOnError;
  readOnly?: boolean;
  stringNumbers?: boolean;
  maxRetriesPerRequest?: number;
  maxLoadingRetryTime?: number;
  enableAutoPipelining?: boolean;
  autoPipeliningIgnoredCommands?: string[];
  maxScriptsCachingTime?: number;
}

export const DEFAULT_REDIS_OPTIONS: IRedisOptions = {
  // Connection
  port: 6379,
  host: "localhost",
  family: 4,
  connectTimeout: 10000,
  disconnectTimeout: 2000,
  retryStrategy: function (times) {
    return Math.min(times * 50, 2000);
  },
  keepAlive: 0,
  noDelay: true,
  connectionName: null,
  // Sentinel
  sentinels: null,
  name: null,
  role: "master",
  sentinelRetryStrategy: function (times) {
    return Math.min(times * 10, 1000);
  },
  natMap: null,
  enableTLSForSentinelMode: false,
  updateSentinels: true,
  // Status
  username: null,
  password: null,
  db: 0,
  // Others
  dropBufferSupport: false,
  enableOfflineQueue: true,
  enableReadyCheck: true,
  autoResubscribe: true,
  autoResendUnfulfilledCommands: true,
  lazyConnect: false,
  keyPrefix: "",
  reconnectOnError: null,
  readOnly: false,
  stringNumbers: false,
  maxRetriesPerRequest: 20,
  maxLoadingRetryTime: 10000,
  enableAutoPipelining: false,
  autoPipeliningIgnoredCommands: [],
  maxScriptsCachingTime: 60000,
};
