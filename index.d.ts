import { Duplex } from 'stream';
import { EventEmitter } from 'events';
interface USocketOptions {
    path?: string;
    fd?: number;
    allowHalfOpen?: boolean;
}
interface USocketWriteChunk {
    data?: Buffer;
    fds?: any[];
    callback?: Function;
}
interface ReadResult {
    data: Buffer | null;
    fds: any[];
}
export declare class USocket extends Duplex {
    private _wrap;
    private fd;
    constructor(opts: string | USocketOptions, cb?: () => void);
    _read(size: number): void;
    _write(chunk: USocketWriteChunk, encoding: string | null, callback: Function): void;
    connect(opts: USocketOptions, cb?: () => void): void;
    private _wrapEvent;
    read(size: number): ReadResult | null;
    read(size: number | null, fdSize?: number | null): ReadResult | null;
    unshift(chunk: any, encoding?: BufferEncoding): void;
    unshift(chunk: Buffer | null, fds?: any[]): void;
    write(chunk: any, encoding?: BufferEncoding, cb?: (error: Error | null | undefined) => void): boolean;
    write(chunk: any, cb?: (error: Error | null | undefined) => void): boolean;
    end(cb?: () => void): this;
    end(data: any, cb?: () => void): this;
    end(data: any, encoding?: BufferEncoding, cb?: () => void): this;
    destroy(): this;
    private maybeClose;
}
export declare class UServer extends EventEmitter<{
    'listening': [];
    'connection': [USocket];
    'error': [Error];
}> {
    private _wrap;
    private paused;
    private listening;
    private fd;
    constructor();
    listen(path: string | {
        path: string;
        backlog?: number;
    }, backlog?: number | (() => void), cb?: () => void): void;
    pause(): void;
    resume(): void;
    close(): void;
    private _wrapEvent;
}
export {};
