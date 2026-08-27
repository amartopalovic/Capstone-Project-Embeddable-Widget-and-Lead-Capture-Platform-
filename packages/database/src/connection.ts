/**
 * Data-layer MongoDB connection.
 *
 * This is distinct from the readiness probe in apps/server, which answers only
 * "is Mongo reachable" and deliberately owns no data concerns. This module owns
 * the connection the repositories and migrations actually use.
 *
 * No Express or HTTP type ever appears here (blueprint section 6.2).
 */

import { MongoClient, type Db, type ClientSession } from 'mongodb';

export interface MongoConnectionOptions {
  readonly uri: string;
  readonly databaseName?: string;
  readonly serverSelectionTimeoutMS?: number;
}

export class MongoConnection {
  readonly #client: MongoClient;
  readonly #databaseName: string | undefined;
  #connected = false;

  constructor(options: MongoConnectionOptions) {
    this.#client = new MongoClient(options.uri, {
      serverSelectionTimeoutMS: options.serverSelectionTimeoutMS ?? 5000,
    });
    this.#databaseName = options.databaseName;
  }

  async connect(): Promise<void> {
    if (this.#connected) return;
    await this.#client.connect();
    this.#connected = true;
  }

  get db(): Db {
    if (!this.#connected) {
      throw new Error('MongoConnection.connect() must be awaited before accessing db');
    }
    return this.#databaseName === undefined
      ? this.#client.db()
      : this.#client.db(this.#databaseName);
  }

  get client(): MongoClient {
    return this.#client;
  }

  /**
   * Run work inside a multi-document transaction.
   *
   * Requires a replica set, which the local Docker Compose topology provides as
   * a single member. Errors must propagate: swallowing them inside the callback
   * prevents the driver from managing the transaction state correctly.
   */
  async withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    return this.#client.withSession(async (session) =>
      session.withTransaction(async () => work(session)),
    );
  }

  /** True when the deployment supports transactions, i.e. it is a replica set. */
  async supportsTransactions(): Promise<boolean> {
    const result = await this.db.admin().command({ hello: 1 });
    return typeof result['setName'] === 'string';
  }

  async close(): Promise<void> {
    await this.#client.close();
    this.#connected = false;
  }
}
