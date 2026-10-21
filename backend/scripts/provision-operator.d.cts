import type { Client } from 'pg';
import type { ReadStream, WriteStream } from 'node:tty';
export interface OperatorInput { email: string; password: string; role: 'STAFF' | 'ADMIN' }
export class ProvisionError extends Error { code: string }
export function validateEnvironment(env: NodeJS.ProcessEnv): string;
export function validateInput(input: OperatorInput): string;
export function parseRole(args: string[]): 'STAFF' | 'ADMIN';
export function provisionOperator(client: Pick<Client, 'query'>, input: OperatorInput, env: NodeJS.ProcessEnv): Promise<{ id: string; role: 'STAFF' | 'ADMIN' }>;
export function readHidden(input: ReadStream, output: WriteStream, prompt: string): Promise<string>;
