"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.UServer = exports.USocket = void 0;
const util = __importStar(require("util"));
const stream_1 = require("stream");
const events_1 = require("events");
const uwrap = require('bindings')('uwrap');
const debug = require('debug');
class USocket extends stream_1.Duplex {
    _wrap;
    fd;
    constructor(opts, cb) {
        const options = typeof opts === 'string' ? { path: opts } : opts || {};
        // I'm guessing those are internal to node and thus not referenced in @types/node?
        // Ignoring for now...
        // @ts-ignore
        const duplexOpts = { writableObjectMode: true };
        // @ts-ignore
        if ("allowHalfOpen" in options)
            duplexOpts.writable = options.allowHalfOpen;
        super(duplexOpts);
        debug("new USocket", options);
        if (options.fd || options.path) {
            this.connect(options, cb);
        }
    }
    _read(size) {
        debug("USocket._read", size);
        if (this._wrap)
            this._wrap.resume();
    }
    _write(chunk, encoding, callback) {
        if (!this._wrap)
            return callback(new Error("USocket not connected"));
        let data;
        let fds;
        let cb;
        if (Buffer.isBuffer(chunk)) {
            data = chunk.data;
        }
        else if (Array.isArray(chunk)) {
            fds = chunk.fds;
        }
        else {
            cb = chunk.callback;
            data = chunk.data;
            fds = chunk.fds;
        }
        if (data && !Buffer.isBuffer(data))
            return callback(new Error("USocket data needs to be a buffer"));
        if (fds && !Array.isArray(fds))
            return callback(new Error("USocket fds needs to be an array"));
        if (cb && typeof cb !== 'function')
            return callback(new Error("USocket write callback needs to be a function"));
        if (!data && !fds)
            return callback(new Error("USocket write needs data or an array"));
        debug("USocket._write", data && data.length, fds);
        const r = this._wrap.write(data, fds);
        if (util.isError(r)) {
            debug("USocket._write error", r);
            return callback(r);
        }
        else if (!data || r === data.length) {
            if (cb)
                cb(chunk);
            return callback();
        }
        debug("USocket._write waiting");
        this._wrap.drain = this._write.bind(this, { data: data.subarray(r), callback: cb }, encoding, callback);
    }
    connect(opts, cb) {
        if (this._wrap)
            throw new Error("connect on already connected USocket");
        if (typeof opts === 'string') {
            opts = { path: opts };
        }
        if (typeof cb === 'function')
            this.once('connected', cb);
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
        if (typeof opts.path !== 'string')
            throw new Error("USocket#connect expects string path");
        this._wrap.connect(opts.path);
    }
    _wrapEvent(event, a0, a1) {
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
                if (!this.push(a0))
                    this._wrap.pause();
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
            if (d)
                d();
        }
    }
    read(size, fdSize) {
        if (!this._wrap)
            return null;
        if (fdSize === undefined)
            return super.read(size ?? undefined);
        if (fdSize === null)
            fdSize = this._wrap.fds.length;
        else if (this._wrap.fds.length < fdSize)
            return null;
        const data = super.read(size ?? undefined);
        if (size && !data)
            return data;
        const fds = this._wrap.fds.splice(0, fdSize);
        return { data: data, fds };
    }
    unshift(chunk, fdsOrEncoding) {
        if (chunk) {
            super.unshift(chunk);
        }
        if (Array.isArray(fdsOrEncoding) && this._wrap) {
            while (fdsOrEncoding.length > 0)
                this._wrap.fds.unshift(fdsOrEncoding.pop());
        }
        throw new Error('Unsupported function call');
    }
    write(chunk, encoding, callback) {
        if (typeof chunk === 'string') {
            chunk = Buffer.from(chunk);
        }
        if (Buffer.isBuffer(chunk)) {
            chunk = { data: chunk };
        }
        if (encoding instanceof Function)
            return super.write(chunk, encoding);
        return super.write(chunk, encoding, callback);
    }
    end(data, encoding, callback) {
        if (data instanceof Function)
            super.end(data);
        else if (encoding instanceof Function)
            super.end(data, encoding);
        else
            super.end(data, encoding, callback);
        if (this._wrap) {
            debug("USocket shutdown");
            this._wrap.shutdownCalled = true;
            this._wrap.shutdown();
            this.read(0);
            this.maybeClose();
        }
        return this;
    }
    destroy() {
        if (!this._wrap)
            return this;
        this._wrap.close();
        this._wrap = null;
        return this;
    }
    maybeClose() {
        if (!this._wrap || !this._wrap.shutdownCalled || !this._wrap.endReceived)
            return;
        debug("USocket closing socket at end");
        this.destroy();
        this.emit('close');
    }
}
exports.USocket = USocket;
//-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----+-----
//--
class UServer extends events_1.EventEmitter {
    _wrap;
    paused;
    listening;
    fd = null;
    constructor() {
        super();
        this.paused = false;
        this.listening = false;
    }
    listen(path, backlog, cb) {
        if (this._wrap || this.listening)
            throw new Error("listen on already listened UServer");
        if (typeof path === 'object') {
            if (typeof backlog === "number")
                throw new Error('Invalid backlog');
            cb = backlog;
            backlog = path.backlog;
            path = path.path;
        }
        else if (typeof backlog === 'function') {
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
    pause() {
        this.paused = true;
        if (this.listening && this._wrap)
            this._wrap.pause();
    }
    resume() {
        this.paused = false;
        if (this.listening && this._wrap)
            this._wrap.resume();
    }
    close() {
        if (!this._wrap)
            return;
        this._wrap.close();
        this._wrap = undefined;
    }
    _wrapEvent(event, a0, a1) {
        if (event === "listening") {
            this.fd = a0;
            debug("UServer listening on " + this.fd);
            this.emit('listening');
            this.listening = true;
            if (!this.paused)
                this._wrap.resume();
        }
        if (event === "error") {
            debug("UServer error", a0);
            this._wrap.close();
            this._wrap = null;
            this.emit("error", a0);
        }
        if (event === "accept") {
            debug("UServer accepted socket " + a0);
            const n = new USocket({ fd: a0 });
            this.emit('connection', n);
        }
    }
}
exports.UServer = UServer;
