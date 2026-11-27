/**
 * Minimal local typings for Bun's built-in SQLite driver.
 * Declared here so the package typechecks on hosts that do not install `bun-types`.
 */
declare module 'bun:sqlite' {
  export interface Statement {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    finalize(): void;
  }

  export interface DatabaseOptions {
    create?: boolean;
    readonly?: boolean;
    strict?: boolean;
  }

  export class Database {
    constructor(filename?: string, options?: DatabaseOptions);
    query(sql: string): Statement;
    prepare(sql: string): Statement;
    exec(sql: string): void;
    run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    close(): void;
    transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T;
  }
}
