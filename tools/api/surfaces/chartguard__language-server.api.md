## @chartguard/language-server

### InputStream
interface InputStream {
    on(event: 'data', listener: (chunk: Uint8Array) => void): unknown;
}

### OutputStream
interface OutputStream {
    write(chunk: Uint8Array): unknown;
}

### ServeOptions
interface ServeOptions {
    readonly input: InputStream;
    readonly output: OutputStream;
    readonly delay?: number;
    readonly onExit?: (code: number) => void;
}

### meta
meta: {
    name: string;
    version: string;
}

### serve
function serve(options: ServeOptions): void;
