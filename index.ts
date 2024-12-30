"use strict";

import * as util from 'util';
import { Duplex, WritableOptions } from 'stream';
import { EventEmitter } from 'events';
const uwrap = require('bindings')('uwrap');
const debug = require('debug');

//-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----
//--

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

export class USocket extends Duplex {
  private _wrap: any;
  private fd: number | undefined;

  constructor(opts: string | USocketOptions, cb?: () => void) {
    const options: USocketOptions = typeof opts === 'string' ? { path: opts } : opts || {};

    // I'm guessing those are internal to node and thus not referenced in @types/node?
    // Ignoring for now...
    // @ts-ignore
    const duplexOpts: WritableOptions = { writableObjectMode: true };
    // @ts-ignore
    if ("allowHalfOpen" in options) duplexOpts.writable = options.allowHalfOpen;

    super(duplexOpts);

    debug("new USocket", options);

    if (options.fd || options.path) {
      this.connect(options, cb);
    }
  }

  _read(size: number): void {
    debug("USocket._read", size);
    if (this._wrap) this._wrap.resume();
  }

  _write(chunk: USocketWriteChunk, encoding: string | null, callback: Function): void {
    if (!this._wrap) return callback(new Error("USocket not connected"));

    let data: Buffer | undefined;
    let fds: any[] | undefined;
    let cb: Function | undefined;

    if (Buffer.isBuffer(chunk.data)) {
      data = chunk.data;
    } else if (Array.isArray(chunk.fds)) {
      fds = chunk.fds;
    } else {
      cb = chunk.callback;
      data = chunk.data;
      fds = chunk.fds;
    }

    if (data && !Buffer.isBuffer(data)) return callback(new Error("USocket data needs to be a buffer"));
    if (fds && !Array.isArray(fds)) return callback(new Error("USocket fds needs to be an array"));
    if (cb && typeof cb !== 'function') return callback(new Error("USocket write callback needs to be a function"));
    if (!data && !fds) return callback(new Error("USocket write needs data or an array"));

    debug("USocket._write", data && data.length, fds);

    const r = this._wrap.write(data, fds);
    if (util.isError(r)) {
      debug("USocket._write error", r);
      return callback(r);
    } else if (!data || r === data.length) {
      if (cb) cb(chunk);
      return callback();
    }

    debug("USocket._write waiting");
    this._wrap.drain = this._write.bind(this, { data: data.subarray(r), callback: cb }, encoding, callback);
  }

  connect(opts: USocketOptions, cb?: () => void): void {
    if (this._wrap) throw new Error("connect on already connected USocket");

    if (typeof opts === 'string') {
      opts = { path: opts };
    }

    if (typeof cb === 'function') this.once('connected', cb);

    debug("USocket connect", opts);

    this._wrap = new uwrap.USocketWrap(this._wrapEvent.bind(this));
    this._wrap.shutdownCalled = false;
    this._wrap.endReceived = false;
    this._wrap.drain = null;
    this._wrap.fds = [];

    if (typeof opts.fd === 'number') {
      this._wrap.adopt(opts.fd);
      this.fd = opts.fd;
      return;
    }

    if (typeof opts.path !== 'string') throw new Error("USocket#connect expects string path");
    this._wrap.connect(opts.path);
  }

  private _wrapEvent(event: string, a0: any, a1: any): void {
    if (event === "connect") {
      this.fd = a0;
      debug("USocket connected on " + this.fd);
      this.emit('connected');
    }

    if (event === "error") {
      debug("USocket error", a0);
      this._wrap.close();
      this._wrap = null;
      this.emit("error", a0);
      this.emit('close', a0);
    }

    if (event === "data") {
      if (a1 && a1.length > 0) {
        debug("USocket received file descriptors", a1);
        this._wrap.fds = this._wrap.fds.concat(a1);
        this.emit('fds', a1);
      }

      if (a0) {
        if (!this.push(a0)) this._wrap.pause();
      }

      if (a1 && !a0) {
        this.emit('readable');
      }

      if (!a0 && !a1 && !this._wrap.endReceived) {
        debug("USocket end of stream received");
        this._wrap.endReceived = true;
        this._wrap.pause();
        this.push(null);
        this.maybeClose();
      }
    }

    if (event === "drain") {
      const d = this._wrap.drain;
      this._wrap.drain = null;
      if (d) d();
    }
  }

  read(size: number, fdSize?: number): ReadResult | null {
    if (!this._wrap) return null;

    if (fdSize === undefined)
      return super.read(size) as ReadResult | null;

    if (fdSize === null)
      fdSize = this._wrap.fds.length;
    else if (this._wrap.fds.length < fdSize) return null;

    const data = super.read(size);
    if (size && !data) return data as ReadResult;

    const fds = this._wrap.fds.splice(0, fdSize);
    return { data: data as Buffer, fds };
  }

  unshift(chunk: any, encoding?: BufferEncoding): void;
  unshift(chunk: Buffer | null, fds?: any[]): void;
  unshift(chunk: any, fdsOrEncoding?: any[] | BufferEncoding): void {
    if (chunk) {
      super.unshift(chunk);
    }

    if (Array.isArray(fdsOrEncoding) && this._wrap) {
      while (fdsOrEncoding.length > 0)
        this._wrap.fds.unshift(fdsOrEncoding.pop());
    }

    throw new Error('Unsupported function call');
  }

  write(chunk: any, encoding?: BufferEncoding, cb?: (error: Error | null | undefined) => void): boolean;
  write(chunk: any, cb?: (error: Error | null | undefined) => void): boolean;
  write(chunk: any, encoding?: BufferEncoding | ((error: Error | null | undefined) => void), callback?: (error: Error | null | undefined) => void): boolean {
    if (typeof chunk === 'string') {
      chunk = Buffer.from(chunk);
    }

    if (Buffer.isBuffer(chunk)) {
      chunk = { data: chunk };
    }

    if (encoding instanceof Function) return super.write(chunk, encoding);
    return super.write(chunk, encoding, callback);
  }

  end(cb?: () => void): this;
  end(data: any, cb?: () => void): this;
  end(data: any, encoding?: BufferEncoding, cb?: () => void): this;
  end(data?: Buffer | (() => void), encoding?: BufferEncoding | (() => void), callback?: () => void): this {
    if (data instanceof Function) super.end(data);
    else if (encoding instanceof Function) super.end(data, encoding);
    else super.end(data, encoding, callback);
    if (this._wrap) {
      debug("USocket shutdown");
      this._wrap.shutdownCalled = true;
      this._wrap.shutdown();
      this.read(0);
      this.maybeClose();
    }
    return this;
  }

  destroy(): this {
    if (!this._wrap) return this;
    this._wrap.close();
    this._wrap = null;
    return this;
  }

  private maybeClose(): void {
    if (!this._wrap || !this._wrap.shutdownCalled || !this._wrap.endReceived)
      return;
    debug("USocket closing socket at end");
    this.destroy();
    this.emit('close');
  }
}

//-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----
//--

export class UServer extends EventEmitter<{ 'listening': [], 'connection': [USocket], 'error': [Error] }> {
  private _wrap: any;
  private paused: boolean;
  private listening: boolean;

  private fd: number | null = null;

  constructor() {
    super();
    this.paused = false;
    this.listening = false;
  }

  listen(path: string | { path: string; backlog?: number }, backlog?: number | (() => void), cb?: () => void): void {
    if (this._wrap || this.listening)
      throw new Error("listen on already listened UServer");

    if (typeof path === 'object') {
      if (typeof backlog === "number") throw new Error('Invalid backlog');
      cb = backlog;
      backlog = path.backlog;
      path = path.path;
    } else if (typeof backlog === 'function') {
      cb = backlog;
      backlog = 0;
    }

    backlog = backlog || 16;

    if (typeof path !== 'string')
      throw new Error("UServer expects valid path");

    if (typeof backlog !== 'number')
      throw new Error("UServer expects valid path");

    if (typeof cb === 'function')
      this.once('listening', cb);

    debug("creating UServerWrap");
    this._wrap = new uwrap.UServerWrap(this._wrapEvent.bind(this));
    debug("start UServerWrap#listen");
    this._wrap.listen(path, backlog);
  }

  pause(): void {
    this.paused = true;
    if (this.listening && this._wrap) this._wrap.pause();
  }

  resume(): void {
    this.paused = false;
    if (this.listening && this._wrap) this._wrap.resume();
  }

  close(): void {
    if (!this._wrap) return;
    this._wrap.close();
    this._wrap = undefined;
  }

  private _wrapEvent(event: string, a0: any, a1: any): void {
    if (event === "listening") {
      this.fd = a0;
      debug("UServer listening on " + this.fd);
      this.emit('listening');
      this.listening = true;
      if (!this.paused) this._wrap.resume();
    }

    if (event === "error") {
      debug("UServer error", a0);
      this._wrap.close();
      this._wrap = null;
      this.emit("error", a0 as Error);
    }

    if (event === "accept") {
      debug("UServer accepted socket " + a0);
      const n = new USocket({ fd: a0 });
      this.emit('connection', n);
    }
  }
}
